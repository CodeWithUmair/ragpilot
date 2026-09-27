"""RagPilot API — FastAPI entrypoint.

Run locally:  uv run fastapi dev app/main.py --port 4000
Docs:         http://localhost:4000/docs
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.api import analytics, chat, chatbots, leads, scrape, testing, users
from app.auth import routes as auth_routes
from app.core.config import get_settings
from app.core.cors import DualCORSMiddleware
from app.core.errors import register_error_handlers
from app.core.version import GIT_SHA, SHORT_SHA, STARTED_AT
from app.db.session import engine
from app.services.email import transport_kind

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ragpilot")


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.connect() as conn:  # fail fast on a bad DATABASE_URL
        await conn.execute(text("SELECT 1"))
    log.info("database connected; email transport: %s; env: %s", transport_kind(), get_settings().app_env)
    yield
    await engine.dispose()


app = FastAPI(
    title="RagPilot API",
    description="Multi-tenant RAG chatbots: crawl a site, answer visitors with grounded, streamed replies, "
    "capture leads.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(DualCORSMiddleware)
register_error_handlers(app)

for router in (auth_routes.router, chat.router, chatbots.router, leads.router, scrape.router,
               analytics.router, users.router, testing.router):
    app.include_router(router)


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "env": get_settings().app_env, "sha": SHORT_SHA}


@app.get("/version", tags=["system"])
async def version():
    return {"sha": GIT_SHA, "shortSha": SHORT_SHA, "startedAt": STARTED_AT, "env": get_settings().app_env}
