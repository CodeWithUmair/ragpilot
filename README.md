# RagPilot

Train a chatbot on any website in minutes, embed it with one script tag, and
let it answer visitors with grounded, streamed replies while capturing leads.

- **Backend:** FastAPI · SQLAlchemy 2.0 (async) · Postgres + pgvector · LangGraph · OpenAI-compatible models
- **Frontend:** Next.js dashboard + embeddable widget
- **Live:** https://rag.umairamir.com (API docs at `/docs`)

## How it works

```mermaid
flowchart LR
  subgraph Training
    A[Website URL] --> B[sitemap.xml + BFS crawl<br/>robots.txt, 5 concurrent]
    B --> C[Strip nav/footer/cookie chrome<br/>heading-aware sections, FAQ pairing]
    C --> D[Drop boilerplate + duplicate chunks<br/>BEFORE paying to embed]
    D --> E[Batch embed<br/>text-embedding-3-small @1024d]
    E --> F[(pgvector<br/>HNSW cosine index<br/>namespace = chatbot)]
  end
  subgraph "Answering (LangGraph)"
    Q[Visitor question] --> G[recall → route → retrieve ⇄ rewrite → generate → capture_lead]
    F --> G
    G --> S[SSE token stream to widget]
  end
```

### The chat agent

The answering path is a LangGraph state machine (`backend/app/rag/graph.py`):

```
START → recall → route ─┬─ smalltalk ─────────────────────────────────┐
                        └─ knowledge → retrieve ─┬─ confident ────────┤
                                 ▲               ├─ weak follow-up → rewrite
                                 └───────────────┘   (max 1 retry)     │
                                                                  generate → capture_lead → END
```

| Node | What it does | Problem it solves |
|---|---|---|
| `recall` | Loads what we already know about the visitor (lead captured earlier) + details typed now | Bot re-asking for an email the visitor already gave |
| `route` | Greetings/thanks skip retrieval | "hi" paying for an embedding and pulling random chunks into the prompt |
| `retrieve` | pgvector top-40 → noise floor → hybrid rerank → dedupe → relative-score gate | Hallucination from footer/nav pollution; adjacent-topic bleed ("AI services" answered with blockchain offerings) |
| `rewrite` | Turns a weak follow-up ("how much is it?") into a standalone query using the conversation, then retries retrieval once | Follow-ups embedded verbatim retrieve nothing, so the bot "forgets" what it just described |
| `generate` | Streams tokens through LangGraph's stream writer → SSE | — |
| `capture_lead` | Silently captures volunteered contact details; shows the form only on real intent, after a qualifying turn, when we still can't reach them | Form popping on the first message / asking for details just typed |

Each decision is a small node, unit-tested with fake models (`tests/test_graph.py`) — no API key or database needed.

### Multi-tenancy

Every chatbot gets a random 32-hex embed token that doubles as its knowledge
namespace. Every vector query filters by it, and every dashboard route checks
ownership (`tests/integration/test_api.py::test_tenant_isolation`).

## Project layout

```
backend/
  app/
    main.py            FastAPI app, routers, lifespan
    core/              settings (pydantic-settings), errors, dual CORS policy
    auth/              Better-Auth-compatible auth: scrypt passwords, signed bearer sessions, Google OAuth
    api/               routers: chat (SSE), chatbots, scrape (SSE), leads, analytics, users/admin
    rag/               graph.py (LangGraph), retrieval.py, prompts.py, providers.py, vector_store.py
    ingest/            crawler, HTML extraction/chunking, file parsing
    services/          email, lead capture + forwarding (email / webhook / Google Sheet)
    db/                SQLAlchemy models + async session
  alembic/             migrations (idempotent initial schema — runs on the legacy DB too)
  tests/               unit + graph tests; integration/ runs against real Postgres
frontend/              Next.js dashboard + widget
deploy/                nginx + VPS guide
```

## Run locally

```bash
docker compose -f docker-compose.dev.yml up -d          # Postgres + pgvector on :5432

cd backend
cp .env.example .env                                    # set OPENAI_API_KEY, AUTH_SECRET
uv sync
uv run alembic upgrade head
uv run fastapi dev app/main.py --port 4000              # http://localhost:4000/docs

cd ../frontend
cp .env.example .env.local
pnpm install && pnpm dev                                # http://localhost:3000
```

Tests:

```bash
cd backend
uv run pytest -q                                        # unit + graph (integration auto-skips without a DB)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ragpilot uv run pytest -q tests/integration
```

Any OpenAI-compatible provider works: set `OPENAI_BASE_URL`, `OPENAI_CHAT_MODEL`
and an embedding model that returns 1024 dimensions.

## Deploy

One VPS, Docker Compose, nginx + certbot in front. See [deploy/README.md](deploy/README.md).

## Swapping the vector database

Ingestion and the chat graph depend on the `VectorStore` protocol in
`backend/app/rag/vector_store.py`, not on pgvector. A Qdrant/Pinecone/Weaviate
backend is one class implementing `upsert`, `search`, `delete_namespace` and
`count`, with the namespace as the tenant filter.
