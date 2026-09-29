# Roadmap

Ordered by value for the project's purpose (a live, defensible portfolio product).
Move items to `HANDOFF.md`'s session log when done.

## Now — go live
- [ ] Deploy: Neon → DigitalOcean App Platform → Vercel (runbook in `HANDOFF.md`)
- [x] Live smoke test with a real OpenAI key (2026-09-28, local only — re-run once deployed)
- [ ] Run the Playwright suites (`frontend/e2e`, `frontend/e2e-ui`) against the new backend
- [ ] DNS for `rag.umairamir.com` (A record) and switch URLs / move to the single-VPS setup

## Next — production hardening
- [x] Per-IP rate limits on `/api/chat`, `/api/leads`, `/api/auth/sign-up/email` (2026-09-29, D19 —
      in-memory fixed-window counter, `lib/rate_limit.py`)
- [ ] Monthly reset of `messageUsage` (period column or scheduled job) — "monthly" limit never resets today
- [ ] Demo tenant: a public, pre-trained chatbot on the landing page so visitors can try it without signing up
- [ ] LLM call log table (`llm_calls`: model, tokens in/out, latency, cost, error, node name) written from
      `providers.py`; a dashboard card showing cost per 100 answers

## Then — proof points for interviews
- [ ] **Eval script** (`backend/evals/`): ~40 questions with expected answers + source pages on one public
      site. Measure answer correctness (LLM-as-judge + source match), citation hit rate, p50/p95 latency,
      cost per 100 questions; store runs; show the latest on a `/eval` page. Run before/after any
      retrieval or graph change — the constants in `rag/retrieval.py` become data-driven.
- [ ] **MCP server** (FastMCP) exposing `search_docs(chatbot, query)` and `ask_docs(chatbot, question)`
      for a public demo chatbot — reuses `rag/graph.py` and `VectorStore`.
- [ ] Structured citations: have the model return `{answer, citations[]}` (e.g. Instructor/Pydantic) and
      render inline source links in the widget.

## Vector database changes (owner's plan)
The seam already exists: `backend/app/rag/vector_store.py` (`VectorStore` protocol:
`upsert`, `search`, `delete_namespace`, `count`). To add e.g. Qdrant:
1. Implement `QdrantVectorStore` with one collection and a `namespace` payload filter
   (or one collection per tenant) — tenant isolation is non-negotiable.
2. Choose the store from settings (`VECTOR_STORE=pgvector|qdrant`) where `PgVectorStore(db)`
   is constructed today (`api/chat.py`, `api/scrape.py`, `api/chatbots.py`).
3. Add a backfill script that reads `KnowledgeVector` rows (including embeddings) and upserts them.
4. Extend `tests/integration` with the same isolation + search assertions for the new store.
Also worth evaluating: hybrid search (pgvector + Postgres full-text `tsvector` with RRF) before
leaving Postgres — the current lexical boost is a lightweight stand-in.

## Sales agent initiative (see `docs/AGENT_VISION.md`)
- [x] Phase 1: lead tiering (COLD/WARM/HOT) — heuristic, no new LLM cost (2026-09-28, D17)
- [x] Phase 2: proactive/qualifying opener — owner writes it, dashboard copy only (2026-09-28, D18)
- [ ] Phase 3a: multi-channel lead notifications (Slack/Discord/Telegram/WhatsApp) — extension of Phase 1's forwarding, not agentic
- [ ] Phase 3b: "here's the checkout link" — prompt/retrieval change using existing `sources`, no tool execution
- [ ] Phase 3c: real tool-calling (add-to-cart, calendar booking, spreadsheet write-back) — deferred until 1, 2, 3a, 3b are live and the LLM call-log table exists

## Later
- [ ] Training as a background job (Arq or a Postgres job table) with progress polling/SSE —
      survives disconnects and redeploys; allows > 50 pages and scheduled re-crawls
- [ ] Image understanding during ingestion (vision model descriptions) — was disabled in the original
- [ ] Human handoff: `interrupt` node in the graph when the visitor asks for a human
- [ ] Stripe billing for the Pro plan (self-serve plan flip is dev-only today)
- [ ] Move `shadcn` to devDependencies; bump GitHub Actions to Node 24-based versions
