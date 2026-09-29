# Handoff — current state of RagPilot

_Last updated: 2026-09-29. Update this file at the end of every working session:
what changed, what is live, what is next. **"Update the handoff" from Umair means
write every detail** — full session log entry, every URL/credential-location/gotcha
touched, not a one-line summary. A new chat should be able to read this file alone
and know exactly what state everything is in.

## TL;DR

**RagPilot is live in production, end to end, as of 2026-09-29.** Visit
https://rag.umairamir.com — real signup/login (including Google OAuth), a real
chatbot can be trained and chatted with, real leads get captured. This did NOT
follow the originally-planned DigitalOcean App Platform route — see "How it's
actually deployed" below and `docs/DECISIONS.md` D20 for why.

- **Frontend**: https://rag.umairamir.com — Vercel, project `ragpilot`, auto-deploys
  on every push to `main`. Fallback URL always works too: https://ragpilot-five.vercel.app
- **Backend API**: https://rag-api.umairamir.com — a shared DigitalOcean droplet
  (`backend-iamdivinity`), NOT App Platform, run via pm2, behind nginx + a real
  Let's Encrypt cert.
- **Database**: Neon Postgres, project `rag-pilot`, direct (non-pooler) connection.
  pgvector + the HNSW index both confirmed present.
- **LLM**: real OpenAI key in use, budget is small on purpose (~$5 total, **$4.94
  left** as of 2026-09-29 — check https://platform.openai.com/home before assuming
  there's room to burn).

Backend is complete and tested (236 tests green as of 2026-09-29, last local run).
Beyond the original Express→FastAPI port, it now has: lead tiering, an
owner-authored proactive opener, Slack/Discord/Telegram lead forwarding, a
checkout-link guardrail, interactive source cards/quick-reply chips in the widget
(`docs/AGENT_VISION.md` phases 1-3b — 3c real tool-calling explicitly paused),
per-IP rate limiting (now actually enforcing in production for the first time),
trust-boundary input validation caps, a real content-and-motion landing page, and
an em-dash-stripping filter on every chat response (Umair: em dashes are the
single biggest "this is AI-generated" tell — see `docs/DECISIONS.md`-adjacent
notes below, and never reintroduce them anywhere user-facing).

## Status board

| Area | Status | Notes |
|---|---|---|
| Backend port (Express → FastAPI) | ✅ Done | 35 routes, same API contract as the old backend |
| LangGraph chat agent | ✅ Done | `backend/app/rag/graph.py` |
| Better-Auth-compatible auth | ✅ Done | Hash/token compat verified; Google OAuth confirmed working in production 2026-09-29 |
| Alembic migrations | ✅ Done | Applied to local dev, Neon, and the production droplet |
| Tests | ✅ 236 passing | Unit + graph + integration (real Postgres/pgvector), last run 2026-09-29 |
| CI (GitHub Actions) | ✅ Green | Backend: ruff + pytest with pgvector service. Frontend: `pnpm build` |
| GitHub | ✅ Pushed | https://github.com/CodeWithUmair/ragpilot (public), branch `main` |
| Database (Neon) | ✅ **Live** | Project `rag-pilot`, direct connection string, migrations applied, pgvector + HNSW index verified present |
| API hosting | ✅ **Live** | NOT App Platform — a shared DigitalOcean droplet, pm2 process `ragpilot-api`, nginx + certbot. See below. |
| Frontend hosting (Vercel) | ✅ **Live** | Project `ragpilot`, Root Directory `frontend`, custom domain attached |
| DNS `rag.umairamir.com` / `rag-api.umairamir.com` | ✅ **Live** | GoDaddy, both records added 2026-09-29, SSL issued on both sides |
| Google OAuth in production | ✅ **Live** (fixed 2026-09-29) | Hit `invalid_client` — the secret had been rotated in Google Cloud Console; regenerated and updated in both envs. See Known gaps for the gotcha. |
| Per-IP rate limiting | ✅ **Now actually enforcing** | Was built production-gated (`lib/rate_limit.py`) specifically so local dev/tests weren't affected — 2026-09-29 is the first time it's live for real |
| Landing page | ✅ Live | Real content mined from `docs/STORY.md`, interactive architecture-flow section, no source/tech-stack reveal (Umair: this must read as a real product, not a portfolio demo) |
| Public demo chatbot on landing page | ❌ Not yet | `LiveDemo` component already built and wired to `NEXT_PUBLIC_DEMO_CHATBOT_TOKEN` — just needs a real trained chatbot + that env var set in Vercel. See Next steps. |
| Real OpenAI end-to-end run | ✅ Done (2026-09-28 local, 2026-09-29 production) | |
| Playwright e2e against new backend | ❌ Not yet run | Specs exist in `frontend/e2e*`; seed endpoints are ported |

## How it's actually deployed (read this before touching prod)

This deviates from the original runbook (kept below for reference/if this ever
moves to App Platform). What's real right now:

### Backend — shared DigitalOcean droplet, not App Platform
- **Droplet**: `backend-iamdivinity`, region SFO2, Ubuntu 25.10, 3.8GB RAM / 116GB
  disk. **This droplet is shared** — it already runs two other owner projects via
  pm2: `divinfi-backend-production` (:8080), `divinfi-backend-staging` (:8081),
  and `pinflow-api` (:4100). RagPilot is a fourth, independent pm2 process
  (`ragpilot-api`, port 4000) — see `docs/DECISIONS.md` D20 for why this was chosen
  over App Platform (budget-conscious; explicit intent to move to dedicated infra,
  Umair mentioned Railway, once real traffic shows up).
- **Public IP**: `157.230.159.213`. Port 4000 is **not** reachable directly from
  the internet (confirmed via external curl test — times out) — only nginx's 80/443
  are exposed, everything else goes through the reverse proxy.
- **Code path**: `/opt/apps/ragpilot` (full git clone, `git pull` to update).
- **Process manager**: `pm2`, process name `ragpilot-api`. Start command matches
  `docker-entrypoint.sh` exactly: `uv run uvicorn app.main:app --host 0.0.0.0
  --port 4000 --proxy-headers --forwarded-allow-ips='*'`. To redeploy a code
  change: `cd /opt/apps/ragpilot && git pull && cd backend && uv sync && pm2
  restart ragpilot-api`.
- **`.env` on the droplet** (`/opt/apps/ragpilot/backend/.env`) — separate from
  local dev's `.env`, has its own values:
  - `APP_ENV=production` (this is what actually turns on rate limiting and the
    SSRF guard — both are no-ops outside production by design)
  - `DATABASE_URL` = the Neon **direct** (non-pooler) connection string
  - `AUTH_SECRET` = a **fresh** secret generated on the droplet, deliberately NOT
    the same as local dev's
  - `API_URL=https://rag-api.umairamir.com`, `APP_URL=https://rag.umairamir.com`
  - `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — **the secret was rotated once
    already** (see Known gaps) — if Google OAuth ever breaks again in prod with
    `invalid_client`, this is almost certainly why; check
    `pm2 logs ragpilot-api --lines 60 --nostream` for the real Google error body
    (routes.py logs it explicitly now, added 2026-09-29 for exactly this).
  - Real `OPENAI_API_KEY` (same one as local dev — **$4.94 of ~$5 left**)
- **nginx site**: `/etc/nginx/sites-available/rag-api.umairamir.com`, proxies to
  `127.0.0.1:4000`. Explicitly sets `X-Forwarded-For`/`X-Forwarded-Proto` headers
  — the sibling sites on this box (`backend.iamdivinity.io` etc.) don't bother
  with this, but RagPilot's rate limiter and IP logging genuinely need it to see
  real visitor IPs through the proxy.
- **TLS**: certbot-managed (`sudo certbot certificates` to check expiry), auto
  http→https redirect confirmed working.
- **A dead sibling service was cleaned up 2026-09-29**: `lightnx-backend`
  (nginx site + expired cert for `lightnx-api.umairamir.com`) was removed —
  confirmed dead first (not in `pm2 list`, nothing listening on its port 8082)
  before deleting anything.

### Frontend — Vercel (as originally planned)
- Project name `ragpilot`, imported from `github.com/CodeWithUmair/ragpilot`,
  **Root Directory = `frontend`**. Auto-deploys on every push to `main`.
- Env vars (Vercel project settings, baked in at build time — redeploy after
  changing): `NEXT_PUBLIC_API_URL=https://rag-api.umairamir.com`,
  `NEXT_PUBLIC_APP_URL=https://rag.umairamir.com`.
- Custom domain `rag.umairamir.com` attached; SSL auto-issued by Vercel once DNS
  resolved. Default `ragpilot-five.vercel.app` URL also always works (backend CORS
  already allows `*.vercel.app`).
- A Vercel-suggested global agent plugin (`npx plugins add vercel/vercel-plugin`)
  was offered post-deploy and **declined** — it targets Cursor/VS Code, not Claude
  Code, and is a broad user-scope install (38 skills, MCP, hooks). Not installed.

### DNS — GoDaddy, zone `umairamir.com`
- `A rag-api → 157.230.159.213` (backend)
- `CNAME rag → 4041d11445a76f9f.vercel-dns-017.com` (frontend, Vercel-assigned
  target — don't reuse this value if the Vercel project is ever recreated, get a
  fresh one from Vercel's domain-add flow)

### Google Cloud OAuth client (Web application, name "RagPilot")
Authorized JavaScript origins now include `https://rag.umairamir.com` and
`https://rag-api.umairamir.com` (plus the original `localhost:3000`/`:4000` for
dev). Authorized redirect URIs now include
`https://rag-api.umairamir.com/api/auth/callback/google` (plus the localhost one).
**The callback lives on the API domain, not the app domain** — a common mistake
would be adding the redirect URI under `rag.umairamir.com` instead.

## Original deployment runbook (NOT what was used — kept for reference)

If this ever moves to DigitalOcean App Platform instead of the shared droplet:

1. **Neon** — already done, see above, reusable regardless of API host.
2. **DigitalOcean App Platform** — import `.do/app.yaml` (builds `backend/Dockerfile`).
   Set encrypted `DATABASE_URL`, `AUTH_SECRET`, `OPENAI_API_KEY`.
3. **Vercel** — already done, see above.
4. **Wire back** — on DO set `API_URL`/`APP_URL`, redeploy.
5. **Google login** — redirect URI `<API URL>/api/auth/callback/google`.
6. **Smoke test** — sign up, train a chatbot, chat, submit a lead.

## Environment facts

- Local dev machine: Windows 11, Git Bash + PowerShell, uv (auto-installed to
  `~/.local/bin` if missing), Python 3.12 (uv-managed), Node via nvm4w, pnpm, Docker Desktop.
- The dev Postgres+pgvector container (`docker-compose.dev.yml`, service `db`,
  container `ragpilot-dev-db-1`) is mapped to **port 5433, not 5432** — a native
  `postgresql-x64-18` Windows service already owns 5432 on this machine. `DATABASE_URL`
  in local `backend/.env` must say `:5433`. Nothing here persists across sessions/reboots —
  `docker compose -f docker-compose.dev.yml up -d` before doing anything else.
- **Nothing survives a session restart, locally or on the droplet reboot**: Docker
  Desktop, the local backend (`uv run fastapi dev`), and the local frontend
  (`pnpm dev`) all need to be started fresh each local session. Check with
  `curl http://127.0.0.1:4000/health`, `curl http://localhost:3000`, `docker ps`
  before assuming anything is already running. The production droplet's pm2
  processes DO persist across reboots (`pm2 save` was run), so production itself
  doesn't need re-starting between chat sessions — only local dev does.
- **Editing any `.env` (local or on the droplet) needs a process restart to take
  effect** — `Settings` is `@lru_cache`d and the dev reloader only watches `.py`
  files, not `.env`. Locally: kill the `uv run fastapi dev` process and restart it.
  On the droplet: `pm2 restart ragpilot-api`.
- The old Express codebase's local clone is at `C:\Users\Ali\Desktop\Umair\chatbase-clone`
  (locally renamed — NOT named `dl-chat-rag`; found via VS Code's history DB, not a
  filename search). Confirmed clean as currently checked out; the malware IS present in
  its git history (commit `6144e0e`) — see `docs/HISTORY.md`'s 2026-09-29 addendum before
  touching that folder at all, especially before checking out any old commit in it.
- `gh` CLI is logged in as `CodeWithUmair`. The Vercel CLI **on this local machine**
  is logged into a *different* account — the actual Vercel deploy was done through
  the browser dashboard instead, not the CLI, for exactly this reason.
- Local `backend/.env` has a real `OPENAI_API_KEY` (rotated once, 2026-09-29 —
  current key has **$4.94 of ~$5 left**, check before assuming budget) and Google
  OAuth credentials. **The Google client secret was rotated in Google Cloud Console
  on 2026-09-29** — if it's ever rotated again, both local `backend/.env` AND the
  droplet's `.env` need the new value (`sed -i` one-liner is in the session log
  below), and both processes need restarting.
- No SSH access to the production droplet from this local machine/Claude session —
  a `ragbot_droplet` key exists locally but isn't authorized on the server. All
  droplet work this session was done via pasting commands into DigitalOcean's
  browser Web Console and pasting output back.

## Known gaps / tech debt (prioritised)

1. **Public demo chatbot for the landing page isn't set up yet.** The `LiveDemo`
   component and `NEXT_PUBLIC_DEMO_CHATBOT_TOKEN` wiring already exist
   (`frontend/src/app/page.tsx`) — needs an actual chatbot created, trained (on
   RagPilot's own docs would be a nice touch), and its embed token set as that env
   var in Vercel. Now safe to do since rate limiting is live.
2. **The shared droplet is explicitly a temporary/budget-conscious choice**, not
   the long-term plan — Umair intends to move to dedicated infra (mentioned
   Railway) once there's real traffic. Don't over-invest in droplet-specific
   tooling assuming it's permanent.
3. **Google client secret rotation gotcha**: Google Cloud Console only shows a
   client secret's full value once, at creation. If `invalid_client` errors show
   up again in the logs, the secret was rotated somewhere and both `.env` files
   need updating — this already happened once (2026-09-29).
4. **"Monthly" message limit never resets** — `messageUsage` only resets via admin
   (inherited from the Express version). Needs a monthly reset job or period column.
5. **Training runs inside the HTTP request** (SSE). Fine for ≤50 pages; a job queue
   (Arq/Postgres jobs) would survive disconnects and redeploys.
6. **Images/vision not ingested** (was disabled in the original too).
7. Playwright e2e suite never run against this backend.
8. CI shows GitHub "Node 20 deprecated" notices for actions — bump action versions eventually.
9. `shadcn` is a runtime dependency in `frontend/package.json`; could move to devDependencies.
10. Unused legacy tables `Verification`, `ShopifyStore` exist in the schema for parity.

## Next steps (suggested order)

1. Set up the public demo chatbot for the landing page (see Known gaps #1).
2. Run the Playwright e2e suites against the now-live production backend.
3. Build the eval script (see `docs/ROADMAP.md`) — gives real numbers for the story.
4. LLM call logging table (tokens, latency, cost) + small dashboard view — also a
   named prerequisite for Phase 3c (paused tool-calling) in `docs/AGENT_VISION.md`.
5. Monthly usage reset job.
6. FastMCP server exposing `search_docs` / `ask_docs`.
7. Vector DB abstraction exercise: second `VectorStore` implementation (e.g. Qdrant).
8. When real traffic justifies it: move the backend off the shared droplet to
   dedicated infra.

## Session log

- **2026-09-27** — Found and removed malware in the source repo (committed + pushed there
  as `b40f9bf`). Created `ragpilot` from the cleaned commit; rewrote the backend in FastAPI
  with a LangGraph agent; ported auth with Better Auth compatibility; idempotent Alembic
  migration; SSRF guard; fixed tenant-isolation holes; 204 tests; Docker/nginx/CI/DO spec;
  frontend rebrand. Pushed to GitHub (`808378f`), CI green. Added this docs/ memory.
- **2026-09-28** — Local dev environment brought up (Docker pgvector remapped to port 5433 —
  a native `postgresql-x64-18` Windows service already owns 5432 on this machine; see
  `docker-compose.dev.yml`). Wrote `docs/AGENT_VISION.md` (proposed sales/support agent
  direction) and shipped phases 1, 2, 3a, 3b from it: `Lead.priority` tiering (D17),
  owner-authored proactive opener (D18), Slack/Discord/Telegram lead forwarding, and a
  checkout-link prompt guardrail. Phase 3c (real tool-calling) explicitly paused. Added
  clickable source cards + quick-reply chips to the widget, reusing the `sources` SSE event
  the backend already sent but the frontend previously discarded — no new backend surface.
  Ran the **first real OpenAI smoke test** (train + chat against a live key) and it
  immediately caught a real bug: `OPENAI_BASE_URL=` (present but empty) resolved to `""`,
  and `AsyncOpenAI(base_url="")` is not the same as unset — every LLM call failed with
  `APIConnectionError`. Fixed at the `Settings` layer (`core/config.py`) so blank means
  `None`, not literal, with a regression test. Pushed in two commits. Also located and
  forensically audited the old local clone (`C:\Users\Ali\Desktop\Umair\chatbase-clone`) —
  confirmed the malware is real, in commit `6144e0e`, still reachable from that clone's
  `main`; current checkout is clean. See `docs/HISTORY.md`'s addendum. Read-only, nothing
  in that folder was touched.
- **2026-09-29 — the deployment day.** In order:
  1. Corrected the stale `D:\mine\dl-chat-rag` path in this file (doesn't exist on this
     machine; real path documented above).
  2. Added per-IP rate limiting (`lib/rate_limit.py`, in-memory fixed-window counter,
     production-only gate matching the SSRF guard's own convention — D19) on
     `/api/chat`, `/api/leads`, `/api/auth/sign-up/email`. Closed real unbounded-field
     validation gaps on public endpoints (`ChatRequest.question`/`history`,
     `LeadCreate`'s string fields and its `fields` dict, sign-up/in/resend's
     email/name) — none of these had any length limit before.
  3. Built the landing page from scratch (root `/` was previously just a redirect to
     `/dashboard` — no marketing page existed at all): `Hero`, `ProblemSolution`,
     `ArchitectureFlow` (interactive, click-through), `LiveDemo`, `LandingNav`,
     `LandingFooter`. Content mined directly from `docs/STORY.md`'s real
     problem/fix table, not generic copy. Uses `motion` (already installed).
  4. Umair: the landing page must read as a real product to visitors, not an open
     portfolio/interview demo — removed the GitHub link, "View source" button, and
     the tech-stack badge strip; rewrote the architecture-flow and problem/solution
     copy to describe behavior in plain language instead of naming implementation
     details or file paths.
  5. Umair: em dashes are the single biggest tell of AI-generated content, strictly
     not allowed anywhere the product shows text. Built `rag/dash_filter.py` — a
     stateful filter applied to the live chat SSE token stream (holds back exactly
     one trailing character per chunk so a dash split across two stream chunks is
     still caught), added an explicit no-em-dash guardrail instruction to the system
     prompt as the primary defense, and swept every actual user-facing string across
     the whole frontend and backend (persona presets, dashboard labels/toasts/help
     text, onboarding copy, lead-forward error messages) — left code comments and the
     dash-as-empty-value UI convention alone, those weren't what was flagged.
  6. Verified the OpenAI budget directly (a minimal live embedding call, not a
     guess) — valid key, had credits. Same for a second key added later the same
     day — also verified live before trusting it. **$4.94 of ~$5 left** as of
     end of session.
  7. Created the Neon Postgres project (`rag-pilot`, AWS US East 2/Ohio, free
     plan — turned OFF the default-on "Object storage" toggle since RagPilot
     doesn't use it). Ran migrations against the **direct** (non-pooler)
     connection string; verified live: all 11 tables + `alembic_version`,
     pgvector extension installed, HNSW index present.
  8. Discovered (via the DigitalOcean dashboard, then the Web Console — no direct
     SSH access) an existing droplet `backend-iamdivinity` already running two
     other owner projects via pm2. Confirmed real headroom (2.8GB available RAM,
     97GB free disk) before proceeding. Umair's call: deploy RagPilot's backend
     here for now (budget-conscious), move to dedicated infra (Railway mentioned)
     once real traffic justifies it — logged as D20.
  9. Installed `uv` on the droplet, cloned the repo to `/opt/apps/ragpilot`, built
     a production `.env` (fresh `AUTH_SECRET`, Neon direct URL, real OpenAI key,
     Google OAuth creds, `API_URL=https://rag-api.umairamir.com`), started via pm2
     with the exact same command `docker-entrypoint.sh` uses
     (`--proxy-headers --forwarded-allow-ips='*'` matters for IP-aware rate
     limiting through the reverse proxy). Verified `/health` locally on the
     droplet before moving on.
  10. Cleaned up a dead sibling service (`lightnx-backend` — nginx site + expired
      cert) after confirming it wasn't actually running (not in `pm2 list`,
      nothing on its port). Nothing live was touched.
  11. Added DNS records at GoDaddy (`umairamir.com` zone): `A rag-api →
      157.230.159.213`, and after deploying the frontend to Vercel, `CNAME rag →`
      whatever target Vercel's domain-add flow gave.
  12. Deployed the frontend to Vercel (project `ragpilot`, Root Directory
      `frontend`, correct `NEXT_PUBLIC_*` env vars). Declined a Vercel-suggested
      global agent-plugin install (targets Cursor/VS Code, not Claude Code, broad
      user-scope — not needed here).
  13. Set up nginx + certbot for `rag-api.umairamir.com` on the droplet, deliberately
      adding `X-Forwarded-For`/`X-Forwarded-Proto` headers the sibling sites don't
      bother with (RagPilot's rate limiter needs real visitor IPs). Verified live,
      externally, with real curl tests: port 4000 unreachable directly (firewalled,
      confirmed good), `https://rag-api.umairamir.com/health` works, `http://`
      correctly 301s to `https://`.
  14. Added the production URLs to the Google Cloud OAuth client (JS origins +
      redirect URI — the redirect URI lives on the API domain, not the app domain).
  15. Google sign-in failed in production with the generic frontend error. Added
      real diagnostic logging to `google_callback` (logs Google's actual response
      body on `HTTPStatusError`, not just the exception repr) — same
      verify-don't-guess approach as the `OPENAI_BASE_URL` bug on 2026-09-28.
      Real error: `invalid_client — The provided client secret is invalid`. The
      secret had been rotated in Google Cloud Console at some point (masked
      secrets can't be recovered, only replaced). Umair generated a new one;
      updated it in both local `backend/.env` and the droplet's `.env`
      (`sed -i 's|^GOOGLE_CLIENT_SECRET=.*|GOOGLE_CLIENT_SECRET=<new>|'`), restarted
      both backends. Confirmed working — reached `/onboarding` after Google login
      on `rag.umairamir.com`.
  16. Minor UI polish: bumped `text-[11px]` to `text-xs` (12px) across the app for
      readability — onboarding step 1 badges, then Umair extended the same fix to
      analytics stat cards, the chatbot customize tab, leads list/detail, and the
      Google Sheet setup guide. Pushed; Vercel auto-redeployed.
  17. **Result: RagPilot is fully live in production**, verified end to end
      including real Google OAuth login, by the end of this session.
