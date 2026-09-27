# Architecture

How every part of RagPilot works, with the file that implements it. Constants
are quoted from the code — if you change one, update it here.

## 1. System overview

```
 Customer's website                 RagPilot frontend (Next.js)            RagPilot API (FastAPI)          Postgres + pgvector
 ┌─────────────────────┐            ┌──────────────────────────┐          ┌──────────────────────┐        ┌─────────────────┐
 │ <script src=        │  iframe    │ /embed  (ChatWidget.tsx) │  SSE     │ /api/chat  (graph)   │  SQL   │ User, Session,  │
 │  chatbot-embed.js   │──────────▶ │                          │────────▶ │ /api/leads           │──────▶ │ Chatbot, Lead,  │
 │  data-token=…>      │            │ /dashboard/*  (owner UI) │  REST    │ /api/chatbots/…      │        │ ChatSession,    │
 └─────────────────────┘            │ /auth, /onboarding       │  + SSE   │ /api/scrape (SSE)    │        │ ChatMessage,    │
                                    └──────────────────────────┘          │ /api/auth/* …        │        │ KnowledgeVector │
                                                                          └──────────┬───────────┘        └─────────────────┘
                                                                                     │ OpenAI-compatible API
                                                                                     ▼ (embeddings + chat)
```

- **Dashboard** (owner): sign up, create chatbot from a URL, train, customise the
  widget, read conversations, manage leads, analytics, admin.
- **Widget** (visitor): `public/chatbot-embed.js` injects an iframe of `/embed?token=…`
  which renders `components/chat/ChatWidget.tsx` (Fin-style: Home / Messages / chat).
  The widget calls only public endpoints.
- **Production topologies:** (a) Vercel frontend + DigitalOcean App Platform API + Neon
  DB (current plan, cross-origin, bearer tokens), or (b) one VPS: docker-compose
  (db, api, web) behind nginx on `rag.umairamir.com` (same origin). Both work because
  auth never relies on cookies.

## 2. Data model (`backend/app/db/models.py`)

Table/column names are exactly what Prisma created (quoted camelCase), so this
backend can run on the legacy database. Timestamps are `timestamp(3)` without
zone holding UTC; `UTCDateTime` attaches UTC on read so JSON says `…Z`.

| Table | Key columns | Notes |
|---|---|---|
| `User` | id (32-char), email (unique), emailVerified, plan, messageUsage, messageLimit, onboardingCompleted | plan ∈ free/pro (legacy keys mapped in `lib/plans.py`) |
| `Session` | token (unique, raw 32-char), expiresAt, userId | 7-day TTL, slides at most once/day |
| `Account` | providerId (`credential`/`google`), accountId, password (scrypt) | one per login method |
| `Chatbot` | embedToken (unique, 32 hex = **namespace**), url+userId unique, widget fields, leadConfig JSONB, isTrained | |
| `ChatbotCategory` | chatbotId, name, pages, enabled, indexed | URL path-segment groups chosen in the Train tab |
| `ChatSession` | sessionId (unique, from widget), namespace, chatbotId, visitorId, firstQuestion, messageCount, hostPageUrl, ipAddress | one conversation thread |
| `ChatMessage` | sessionId → ChatSession.sessionId, question, answer | one Q/A turn |
| `Lead` | chatbotId, namespace, sessionId, name/email/phone/company, status NEW/CONTACTED/ARCHIVED, syncedAt | one lead per session (deduped) |
| `KnowledgeVector` | namespace, contentHash (unique per namespace), type, sectionType, headingPath, source, title, content, metadata JSONB, embedding vector(1024) | HNSW index `KnowledgeVector_embedding_hnsw_idx` (cosine, m=16, ef_construction=64) |
| `Verification`, `ShopifyStore` | — | legacy, unused, kept for schema parity |

**Multi-tenancy:** a chatbot's `embedToken` is random (`secrets.token_hex(16)`), not
a hash of its URL, so two users training the same site get separate namespaces.
Every vector search has `WHERE namespace = :namespace`.

## 3. Ingestion / training (`api/scrape.py`, `ingest/*`)

Two phases, both `GET /api/scrape`:

**Phase 1 — discovery (JSON).** `crawler.discover(url)` runs in parallel:
- `sitemap.xml` (+ nested sitemap indexes, depth ≤ 2), and
- a same-origin BFS crawl: waves of `CONCURRENCY = 5` fetches, up to `MAX_PAGES = 50`,
  honouring `robots.txt`, skipping `/checkout /cart /login /signup /account /admin /wp-admin /search`.

URLs are grouped by first path segment ("category"); the dashboard shows an
accordion of categories → pages with checkboxes.

**Phase 2 — indexing (SSE).** Given `categories` (and usually the exact `urls` list),
a pool of `INDEX_CONCURRENCY = 5` workers pulls from a shared iterator. Per page:

1. Fetch (via SSRF-guarded client) → `parse_html` in a worker thread (`asyncio.to_thread`; lxml is CPU-bound).
2. Skip 4xx and soft-404s (`looks_like_error_page`).
3. Remove chrome (`CHROME_SELECTORS`: nav/header/footer/cookie banners…).
4. Walk `h1–h6, p, li, td, th` in order, carrying a heading path ("Pricing > Pro plan");
   a heading ending in `?` + the next `<p>` becomes an FAQ chunk
   (`Question: … Answer: …`, type `faq`). Blocks < 20 chars dropped.
5. Split each section into 500-char chunks with 50 overlap (min 41 chars).
6. `clean_chunks`: drop boilerplate (`lib/text_clean.is_boilerplate`) and chunks whose
   normalised hash was already seen this run — **before** paying for embeddings.
7. One batched embedding call per page (batches of 96), then one `executemany`
   upsert with `ON CONFLICT (namespace, contentHash)`; `contentHash` is
   content-based, so the same text on many pages is stored once.

Events stream to the Train tab (`useScrapeStream.ts`). If the client disconnects,
Starlette cancels the generator and the `finally` cancels the worker pool — no more
paid embeddings. File upload (`/api/scrape/file`: PDF/DOCX/TXT/CSV/MD, ≤ 20 MB,
parsed in a thread) and raw text (`/api/scrape/text`) use the same chunk → embed →
upsert path, after an ownership check on the namespace.

## 4. Answering — the LangGraph agent (`rag/graph.py`)

```
START → recall → route ─┬─ smalltalk ────────────────────────────────┐
                        └─ knowledge → retrieve ─┬─ confident ───────┤
                                 ▲               ├─ weak follow-up → rewrite
                                 └───────────────┘  (≤ MAX_REWRITES=1)│
                                                               generate → capture_lead → END
```

State (`ChatState`): question, history, contact, route, search_query, rewrites,
top_score, matches, sources, answer, show_lead_form.
Per-request collaborators (`ChatDeps`: llm, embedder, store, leads, namespace,
persona, business_name, lead_config) are passed in `config["configurable"]["deps"]`
— the graph is compiled once at import (`chat_graph`) and holds no request state.

| Node | Logic |
|---|---|
| `recall` | `extract_contact(question)` merged over the lead already stored for this session (`LeadStore.known_contact`) → `contact` ("agent memory"). |
| `route` | `_SMALLTALK_RE` (hi/hello/thanks/ok/bye/salam…) → `smalltalk` skips retrieval; else `knowledge`. Sets `search_query = question`, `rewrites = 0`. |
| `retrieve` | Embed `search_query`, pgvector top `RETRIEVAL_POOL=40`, then `retrieval.select_context`: drop raw cosine < `MIN_RAW_SCORE=0.18` → hybrid rerank (cosine + 0.25×keyword overlap + type prior: text/document/faq +0.05, image +0.2 if asked, link +0.08 if asked) → dedupe/boilerplate filter → keep only within `RELATIVE_SCORE_MARGIN=0.22` of the best → max `CONTEXT_CHUNKS=12`. Records `top_score` = best raw cosine. |
| `after_retrieve` (edge) | `top_score ≥ CONFIDENT_SCORE=0.35` → generate. Weak **and** there is history **and** no rewrite yet → `rewrite`. Otherwise generate (the prompt's no-context rules handle it). |
| `rewrite` | LLM (temp 0, ≤60 tokens) turns the follow-up into a standalone search query from the last 3 turns; loops back to `retrieve`. |
| `generate` | Emits `sources` (matches with a URL and score > 0.5, max 5), builds the system prompt (`rag/prompts.py`: persona + grounding guardrails + optional lead nudge + visitor memory + Context), sends last 6 history turns + question, streams tokens (temp 0.2, max 1500) as `delta` events via `get_stream_writer()`. |
| `capture_lead` | Only if lead capture is enabled. Volunteered email/phone/name/company → `LeadStore.capture` (silently; new leads with a handle are forwarded once). Emits `lead` (show the form) only if: `detect_lead_intent(question)` **and** ≥ `LEAD_FORM_MIN_PRIOR_TURNS=1` prior turns **and** no email/phone known **and** none typed now. |

**HTTP layer (`api/chat.py`):** resolves the chatbot + owner by token, checks the
owner's quota (over limit → polite canned reply, `done.limitExceeded=true`, model
never called), upserts `ChatSession` (`INSERT … ON CONFLICT (sessionId)`), runs
`chat_graph.astream(..., stream_mode=["custom","values"])` forwarding custom events
as SSE, then persists `ChatMessage` (partial answer on failure) and increments
`messageUsage` before sending `done`. Errors → `error` event (generic text in production).

### Prompt guardrails (`rag/prompts.py`)
Persona = the chatbot's `systemPrompt` or a default; guardrails are **always**
appended so a custom persona can't disable them: only use Context facts; the
3-step "direct match / say we don't offer it / only then a genuinely equivalent
alternative" rule (prevents keyword-only pitches like "Ethereum converter" for
"calculator"); no invented prices/timelines; reply in the visitor's language;
optional lead nudge (qualify first, never ask for contact details in the first reply).

## 5. Auth (`auth/*`)  <a id="auth"></a>

Re-implements the subset of **Better Auth** the frontend uses, byte-compatible so
the `better-auth/react` client and existing user rows keep working.

| Piece | Format |
|---|---|
| Password hash | `"<saltHex>:<hex(scrypt(NFKC(password), salt=<saltHex as UTF-8 bytes>, N=16384, r=16, p=1, dkLen=64))>"` (`security.py`) |
| Session token | raw 32 chars in `Session.token`; clients hold `"<token>.<base64 HMAC-SHA256(AUTH_SECRET, token)>"` (may arrive URL-encoded; bare tokens accepted too) |
| Transport | Sign-in/up responses carry header **`set-auth-token`** (exposed via CORS); client sends `Authorization: Bearer <signed>` on every request. Cookies `better-auth.session_token` are also read (local dev) |
| Email verification | HS256 JWT `{email}` 1 h; link `API_URL/api/auth/verify-email?token=…&callbackURL=…` |
| Google OAuth | `GET /api/login/google` (top-level navigation → first-party state cookie `rp_oauth_state`) → Google → `GET /api/auth/callback/google` → find/link/create user → redirect `APP_URL/auth/callback#token=<signed>` |

`auth/deps.current_user` resolves the session, pins `TEST_PRO_EMAILS` to Pro,
keeps `messageLimit` in sync with the plan, and returns `AppUser`
(`is_admin` from `ADMIN_EMAILS`). `REQUIRE_EMAIL_VERIFICATION=false` → signups are
verified immediately and get a token straight away.

## 6. Leads (`services/leads.py`, `api/leads.py`)

- Sources: the widget form (`POST /api/leads`, public) and chat (`capture_lead` node).
- One lead per `(chatbotId, sessionId)`; later submissions/turns enrich it and are
  **not** re-forwarded.
- Forwarding (new leads only, best-effort, after the response —
  `BackgroundTasks` for the form, `asyncio.create_task` from chat):
  owner email (if `notifyEmail`), `webhookUrl` (Zapier/Make/n8n), `sheetUrl`
  (Google Apps Script web app). `syncedAt` set if anything delivered.
- `test-forward` diagnoses common Apps Script failures: Workspace-restricted
  `/a/macros/<domain>/` URLs, redirects to Google sign-in (not public), 401/403.
- `leadConfig` JSON resolved by `lib/lead_config.resolve_lead_config`;
  `public_lead_config` hides destinations from the widget.

## 7. CORS (`core/cors.py`)

Two policies chosen by path, reflecting the Origin (never `*`) with credentials:
- **Public** (`/api/chat*`, `/api/chatbots/public/*`, `/api/leads`): any origin.
- **Strict** (everything else): `APP_URL`, localhost, `CORS_EXTRA_ORIGINS`, and hosts
  ending in `CORS_ORIGIN_SUFFIXES` (default `.vercel.app,.umairamir.com`).
`Access-Control-Expose-Headers: set-auth-token` is required for login to work cross-origin.

## 8. Security measures

- **Tenant isolation** — ownership checks on every chatbot-scoped route, including
  `/api/sessions/{namespace}` and `/api/scrape/file|text` (both were open in the Express version).
- **SSRF guard** (`lib/net.py`) — in production, every crawler/webhook request (and each
  redirect) must resolve to public IPs only. Disabled outside production so you can crawl localhost.
- Dev-only `/api/__test/*` endpoints 404 in production.
- Production errors never leak exception text to the public widget.
- Upload size cap 20 MB; nginx `client_max_body_size 25m`.

## 9. Email (`services/email.py`)

Transport priority: Resend API → Gmail SMTP (app password) → generic SMTP → log only.
Outside production every email is captured in memory (`GET /api/__test/emails`) and
recipients on `.test/.invalid/.example/example.com/ragbot.dev` are never really sent.

## 10. Configuration

All settings in `core/config.py` (pydantic-settings, `.env` in dev); documented in
`backend/.env.example`. Aliases for the old deployment: `NODE_ENV`→`APP_ENV`,
`BETTER_AUTH_SECRET`→`AUTH_SECRET`, `ADMIN_EMAIL`→`ADMIN_EMAILS`.
`db/session.async_database_url` converts any `postgresql://` URL for asyncpg
(drops Prisma params and `channel_binding`, maps `sslmode` → `ssl`).

## 11. Testing strategy

| Suite | Needs | Covers |
|---|---|---|
| `tests/test_graph.py` | nothing | every graph branch with FakeLLM/FakeEmbedder/FakeStore/FakeLeads |
| `tests/test_*.py` (unit) | nothing (Node-generated fixtures embedded) | text cleaning, extraction, retrieval ranking, lead config, plans, auth crypto compat, URL handling |
| `tests/integration/test_api.py` | migrated Postgres at `DATABASE_URL` (auto-skip otherwise) | auth protocol, CRUD, plan limits, tenant isolation, full chat SSE through the graph with fake models, quota refusal, lead dedupe, CORS |
| `frontend/e2e*` (Playwright) | running API + frontend | UI flows (not yet re-run against this backend) |
