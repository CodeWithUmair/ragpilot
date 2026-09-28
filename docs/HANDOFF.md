# Handoff — current state of RagPilot

_Last updated: 2026-09-27. Update this file at the end of every working session:
what changed, what is live, what is next._

## TL;DR

The FastAPI + LangGraph backend is complete, tested (204 tests green locally and
in CI) and pushed to GitHub. **Nothing is deployed yet.** Deployment is being done
manually by the owner: Neon (DB) → DigitalOcean App Platform (API) → Vercel
(frontend). The custom domain `rag.umairamir.com` comes later (DNS not configured).

## Status board

| Area | Status | Notes |
|---|---|---|
| Backend port (Express → FastAPI) | ✅ Done | 35 routes, same API contract as the old backend |
| LangGraph chat agent | ✅ Done | `backend/app/rag/graph.py`, 8 graph tests with fake models |
| Better-Auth-compatible auth | ✅ Done | Hash/token compat verified against Node-generated fixtures |
| Alembic migrations | ✅ Done | Verified on a fresh DB and on a simulated legacy Prisma DB (data kept, HNSW index restored) |
| Tests | ✅ 204 passing | Unit + graph + integration (real Postgres/pgvector) |
| CI (GitHub Actions) | ✅ Green | Backend: ruff + pytest with pgvector service. Frontend: `pnpm build` |
| Docker images | ✅ Build & run | API runs migrations then uvicorn; web runs Next standalone |
| Frontend rebrand RagBot → RagPilot | ✅ Done | Also fixed a broken embed snippet (`cdn.ragbot.ai` didn't exist) |
| GitHub | ✅ Pushed | https://github.com/CodeWithUmair/ragpilot (public), branch `main` |
| Database (Neon) | ⏳ Owner to create | Use the **direct** (non-pooler) connection string |
| API hosting (DigitalOcean App Platform, client's account) | ⏳ Owner to do | Spec: `.do/app.yaml` |
| Frontend hosting (Vercel) | ⏳ Owner to do manually | Root Directory = `frontend` |
| DNS `rag.umairamir.com` | ⏳ Later | Then switch to the single-VPS setup in `deploy/` or just repoint URLs |
| Real OpenAI end-to-end run | ✅ Done locally (2026-09-28) | Trained + chatted against a real key; caught and fixed a real bug (see Known gaps). Still worth re-running once deployed. |
| Playwright e2e against new backend | ❌ Not yet run | Specs exist in `frontend/e2e*`; seed endpoints are ported |

## Deployment runbook (in order — each step needs the previous step's URL)

1. **Neon** — create project (region near the DO app). Copy the connection string
   with *Connection pooling OFF* (host must not contain `-pooler`; asyncpg's prepared
   statements break behind PgBouncer transaction pooling). `sslmode=require` and
   `channel_binding` are handled by `db/session.py`. Tables + `vector` extension are
   created automatically on first API boot (`docker-entrypoint.sh` runs `alembic upgrade head`).
2. **DigitalOcean App Platform** — import `.do/app.yaml` (builds `backend/Dockerfile`;
   repo is public so no GitHub auth needed; switch to a `github:` block with
   `deploy_on_push: true` for auto-deploys). Set encrypted `DATABASE_URL`,
   `AUTH_SECRET`, `OPENAI_API_KEY`. Check `https://<app>.ondigitalocean.app/health`.
3. **Vercel** — import repo, Root Directory `frontend`, env
   `NEXT_PUBLIC_API_URL=<DO URL>`, `NEXT_PUBLIC_APP_URL=<Vercel URL>`
   (these are baked in at build time — redeploy after changing).
4. **Wire back** — on DO set `API_URL=<DO URL>`, `APP_URL=<Vercel URL>`, redeploy.
   CORS already allows `*.vercel.app` and `*.umairamir.com` (`CORS_ORIGIN_SUFFIXES`).
5. **Optional Google login** — redirect URI `<API URL>/api/auth/callback/google`,
   set `GOOGLE_CLIENT_ID/SECRET`.
6. **Smoke test** — sign up, create a chatbot for a small site, train it, chat in the
   widget, submit a lead. Watch `docker logs`/DO runtime logs for errors.

Later, with DNS: either keep Vercel + DO and point `rag.umairamir.com` at Vercel
(API on `api.rag…` or keep the DO URL), or move everything to one VPS with
`docker-compose.yml` + `deploy/nginx/` (same-origin, see `deploy/README.md`).

## Environment facts

- Local dev machine: Windows 11, Git Bash + PowerShell, uv 0.11, Python 3.12 (uv-managed), Node via nvm4w, pnpm, Docker Desktop.
- A local test DB container may exist: `ragpilot-pg` (`pgvector/pgvector:pg17`) on
  `postgresql://postgres:postgres@localhost:5433/ragpilot`. Stop with `docker stop ragpilot-pg`.
- The old Express codebase lives at `D:\mine\dl-chat-rag` (reference only — see `docs/HISTORY.md`).
- `gh` CLI is logged in as `CodeWithUmair`. The Vercel CLI on this machine is logged into a
  *different* account — don't deploy with it unless the owner confirms.

## Known gaps / tech debt (prioritised)

1. **No rate limiting** on public endpoints (`/api/chat`, `/api/leads`, signup). Per-owner
   message quota exists, but abuse could still burn OpenAI credit. Add per-IP limits.
2. **"Monthly" message limit never resets** — `messageUsage` only resets via admin
   (inherited from the Express version). Needs a monthly reset job or period column.
3. **Training runs inside the HTTP request** (SSE). Fine for ≤50 pages; a job queue
   (Arq/Postgres jobs) would survive disconnects and redeploys.
4. **Images/vision not ingested** (was disabled in the original too).
5. CI shows GitHub "Node 20 deprecated" notices for actions — bump action versions eventually.
6. `shadcn` is a runtime dependency in `frontend/package.json`; could move to devDependencies.
7. Unused legacy tables `Verification`, `ShopifyStore` exist in the schema for parity.

## Next steps (suggested order)

1. Finish deployment (runbook above) and do the live smoke test.
2. Add per-IP rate limiting + monthly usage reset.
3. Build the eval script (see `docs/ROADMAP.md`) — gives real numbers for the story.
4. LLM call logging table (tokens, latency, cost) + small dashboard view.
5. FastMCP server exposing `search_docs` / `ask_docs`.
6. Vector DB abstraction exercise: second `VectorStore` implementation (e.g. Qdrant).

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
  `None`, not literal, with a regression test. Pushed in two commits.
