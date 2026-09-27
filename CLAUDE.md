# CLAUDE.md — RagPilot

Claude Code loads this file into every session in this repo. It is the entry
point to the project's memory; the deep detail lives in `docs/` (start with
`docs/HANDOFF.md` for the current state and what to do next).

## What this is

RagPilot is a multi-tenant "chat with your website" SaaS, like Chatbase: a user
signs up, gives a website URL, the backend crawls and embeds it, and the user
embeds a chat widget (one `<script>` tag) on their site. Visitors get grounded,
streamed answers; the bot captures leads and forwards them to the owner.

- Owner: Umair Amir (GitHub `CodeWithUmair`). Public repo: https://github.com/CodeWithUmair/ragpilot
- Target URL: https://rag.umairamir.com (DNS not set up yet — see HANDOFF)
- Purpose: a live, production-quality portfolio project to show clients and
  interviewers — specifically Python/FastAPI + RAG + LangGraph skills on top of
  the owner's Node/NestJS background.

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 async + asyncpg, Alembic, Pydantic v2 / pydantic-settings, uv |
| AI | LangGraph (chat agent), OpenAI SDK against any OpenAI-compatible API, `text-embedding-3-small` @ 1024 dims, `gpt-4o-mini` |
| Vector DB | Postgres + pgvector (HNSW, cosine), behind a swappable `VectorStore` protocol |
| Frontend | Next.js 16 (App Router), React 19, TanStack Query, Tailwind 4, shadcn/radix, pnpm, `better-auth/react` client |
| Tests | pytest + pytest-asyncio (unit, graph-with-fakes, integration on real Postgres); Playwright e2e in frontend |
| Deploy | Docker, docker-compose, nginx + certbot (VPS); DigitalOcean App Platform spec; Vercel for frontend; Neon for DB |

## Commands

```bash
# Local Postgres + pgvector on :5432
docker compose -f docker-compose.dev.yml up -d

# Backend (from backend/)
uv sync
cp .env.example .env                                   # fill AUTH_SECRET, OPENAI_API_KEY
uv run alembic upgrade head
uv run fastapi dev app/main.py --port 4000             # docs at http://localhost:4000/docs
uv run ruff check .                                    # lint (must pass — CI runs it)
uv run pytest -q                                       # integration tests auto-skip without a DB
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ragpilot uv run pytest -q   # everything

# Frontend (from frontend/)
pnpm install && pnpm dev                               # http://localhost:3000
pnpm build
```

## Repository map

```
backend/app/
  main.py              app factory: routers, DualCORSMiddleware, error handlers, lifespan, /health, /version
  core/                config.py (Settings), errors.py (AppError + one error shape), cors.py, version.py
  db/                  models.py (SQLAlchemy, Prisma-compatible names), session.py (engine, get_db, URL normalising)
  auth/                security.py (scrypt/HMAC/JWT), service.py (users/sessions/verify email),
                       routes.py (Better-Auth wire protocol + Google OAuth), deps.py (CurrentUser/AdminUser/DB)
  api/                 chat.py (SSE), scrape.py (discovery + SSE indexing, file/text upload), chatbots.py,
                       leads.py, analytics.py, users.py (+admin), testing.py (dev-only E2E seeds), schemas.py
  rag/                 graph.py (LangGraph agent), retrieval.py (ranking constants), prompts.py,
                       providers.py (Embedder/ChatModel protocols + OpenAI impl), vector_store.py (VectorStore + pgvector)
  ingest/              crawler.py (sitemap + BFS, robots), extract.py (HTML → chunks), files.py (PDF/DOCX/TXT/CSV)
  services/            email.py (Resend → Gmail → SMTP → log), leads.py (capture, forwarding, test-forward)
  lib/                 text_clean, contact_extract, lead_config, plans, embed_token, sse, net (SSRF guard)
backend/alembic/       0001_initial_schema.py — idempotent raw SQL, safe on the legacy Prisma DB
backend/tests/         test_graph.py, unit tests per module, integration/test_api.py
frontend/src/          app/ (dashboard, auth, onboarding, embed), components/chat/ChatWidget.tsx,
                       hooks/useApi.ts (all REST calls), useChatStream.ts / useScrapeStream.ts (SSE)
frontend/public/chatbot-embed.js   the embeddable loader customers paste on their sites
deploy/                nginx config + VPS guide;  .do/app.yaml  DigitalOcean App Platform spec
docs/                  the project memory — see below
```

## Hard rules (read before changing code)

1. **The frontend's API contract is fixed.** Paths, JSON field names (camelCase),
   SSE event names/payloads and error shape `{error, message, code}` must stay
   compatible with `frontend/src/hooks/*` and `ChatWidget.tsx`. Full contract:
   `docs/API_CONTRACT.md`. Change both sides together or not at all.
2. **Auth speaks the Better Auth protocol** (frontend uses `better-auth/react`).
   Password hash format, signed token format, `set-auth-token` header and
   `/api/auth/*` shapes are compatibility-critical. See `docs/ARCHITECTURE.md#auth`.
3. **DB names are Prisma's quoted camelCase** (`"Chatbot"."embedToken"`), mapped to
   snake_case attributes in `models.py`. Never rename columns. New migrations go in
   `backend/alembic/versions/`, and stay idempotent where they may touch the legacy DB.
4. **Tenant isolation:** every vector query filters by `namespace` (= chatbot
   `embedToken`); every dashboard route checks the chatbot belongs to the caller.
   Add a case to `tests/integration/test_api.py::test_tenant_isolation` for new routes.
5. **Streaming routes open their own DB session inside the generator**
   (`SessionLocal()`), never the request-scoped `get_db` one.
6. **Server-side fetches of user URLs go through `lib/net.safe_client`** (SSRF guard).
7. Retrieval/graph constants in `rag/retrieval.py` and `rag/graph.py` were each tuned
   against a real failure (documented inline). Don't change them without a test.
8. Keep `uv run ruff check .` and `uv run pytest -q` green. New graph behaviour gets
   a test in `tests/test_graph.py` using the fakes there.
9. **Security history:** the original codebase this was ported from contained
   malware (an auto-run `.vscode/tasks.json` executing a fake `.woff2`, and a payload
   appended to `postcss.config.mjs`). Never add `.vscode/tasks.json`, `folderOpen`
   tasks, or copy files wholesale from the old repo. See `docs/HISTORY.md`.

## Conventions

- Settings only via `get_settings()`; env vars documented in `backend/.env.example`.
- Raise `AppError(message, status, code)`; never return ad-hoc error JSON.
- Request/response models live in `api/schemas.py` (`CamelModel` → camelCase on the wire).
- Comments explain *why* (the failure a line prevents), not what.
- Commit messages: imperative summary + body explaining why; end with the
  `Co-Authored-By` trailer when an AI assisted.

## Docs index

| File | Read it when |
|---|---|
| `docs/HANDOFF.md` | Starting a session — current status, deployment state, open items, next steps |
| `docs/ARCHITECTURE.md` | Changing any flow: chat graph, retrieval, ingestion, auth, leads, CORS, data model |
| `docs/API_CONTRACT.md` | Touching any endpoint or SSE event |
| `docs/DECISIONS.md` | Wondering "why is it like this?" — decision log with reasons |
| `docs/HISTORY.md` | Origin of the project, what the port changed, bugs fixed, security incident |
| `docs/ROADMAP.md` | Planning new work (vector DB swap, evals, MCP server, …) |
| `docs/STORY.md` | Explaining the project to a client/interviewer |
