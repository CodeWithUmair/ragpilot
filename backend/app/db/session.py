"""Async SQLAlchemy engine + a per-request session dependency."""

from collections.abc import AsyncIterator

from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings


def async_database_url(raw: str) -> tuple[URL, dict]:
    """Turn a Prisma-style `postgresql://…?schema=public&sslmode=require` URL
    into an asyncpg URL. asyncpg rejects unknown query params, and wants
    sslmode passed as the `ssl` connect arg instead."""
    url = make_url(raw)
    query = dict(url.query)
    connect_args: dict = {}
    # Prisma-only params, plus libpq's channel_binding (Neon adds it) which asyncpg rejects.
    for unsupported in ("schema", "pgbouncer", "connection_limit", "pool_timeout", "channel_binding"):
        query.pop(unsupported, None)
    if (sslmode := query.pop("sslmode", None)) and sslmode != "disable":
        connect_args["ssl"] = sslmode
    return url.set(drivername="postgresql+asyncpg", query=query), connect_args


_url, _connect_args = async_database_url(get_settings().database_url)
engine = create_async_engine(_url, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
