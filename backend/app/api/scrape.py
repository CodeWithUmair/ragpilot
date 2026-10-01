"""Knowledge ingestion: website discovery + indexing, file upload, raw text."""

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.auth.deps import DB, CurrentUser
from app.core.errors import AppError
from app.db.models import Chatbot
from app.db.session import SessionLocal
from app.ingest import crawler
from app.ingest.extract import (
    clean_chunks,
    content_hash,
    detect_page_type,
    looks_like_error_page,
    parse_html,
    sha256,
    split_text,
    url_category,
)
from app.ingest.files import UnsupportedFile, extract_text
from app.lib.plans import plan_for
from app.lib.sse import SSE_HEADERS, SSE_MEDIA_TYPE, sse
from app.lib.text_clean import collapse_ws
from app.rag.providers import OpenAIEmbedder
from app.rag.vector_store import PgVectorStore, VectorRecord

log = logging.getLogger("ragpilot.scrape")
router = APIRouter(prefix="/api", tags=["training"])

INDEX_CONCURRENCY = 5
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _csv(value: str | None) -> list[str]:
    return [v for v in (value or "").split(",") if v]


@router.get("/scrape")
async def scrape(request: Request, user: CurrentUser, db: DB, url: str, categories: str | None = None,
                 urls: str | None = None):
    """Phase 1 (no categories): JSON list of discovered pages grouped by category.
    Phase 2 (categories given): SSE progress stream while pages are indexed."""
    namespace = await db.scalar(select(Chatbot.embed_token).where(Chatbot.url == url, Chatbot.user_id == user.id))
    if not namespace:
        raise AppError("No chatbot found for this URL. Create the chatbot first.", 404)

    selected_categories, selected_urls = _csv(categories), _csv(urls)
    max_pages = (await plan_for(db, user.plan))["pageLimit"]
    if not selected_categories:
        return await _discover(url, namespace, max_pages)
    return StreamingResponse(
        _index_stream(request, url, namespace, selected_categories, selected_urls, max_pages),
        media_type=SSE_MEDIA_TYPE, headers=SSE_HEADERS,
    )


async def _discover(url: str, namespace: str, max_pages: int) -> dict:
    t0 = time.perf_counter()
    sitemap, crawled = await crawler.discover(url, max_pages)
    unique = list(dict.fromkeys([*sitemap, *crawled]))[:max_pages]
    by_category: dict[str, list[str]] = {}
    for page in unique:
        by_category.setdefault(url_category(page), []).append(page)
    log.info("discovery %s in %.1fs: sitemap=%d crawled=%d unique=%d",
             url, time.perf_counter() - t0, len(sitemap), len(crawled), len(unique))
    return {
        "message": "Discovery completed",
        "namespace": namespace,
        "totals": {"sitemap": len(sitemap), "crawled": len(crawled), "unique": len(unique)},
        "categories": [{"name": n, "pages": len(u), "urls": u, "enabled": True} for n, u in by_category.items()],
    }


async def _index_stream(request: Request, base_url: str, namespace: str, categories: list[str], urls: list[str],
                        max_pages: int):
    # First event immediately, so the UI leaves "Connecting…" and its silence
    # watchdog sees a heartbeat.
    yield sse("phase", {"phase": "crawling", "message": "Preparing pages…"})

    if urls:  # the dashboard already discovered pages; skip the expensive re-crawl
        targets, total_discovered = urls[:max_pages], len(urls)  # server-side cap: the client's list is untrusted
    else:
        yield sse("phase", {"phase": "crawling", "message": "Crawling site..."})
        sitemap, crawled = await crawler.discover(base_url, max_pages)
        everything = list(dict.fromkeys([*sitemap, *crawled]))
        targets = [u for u in everything if url_category(u) in categories][:max_pages]
        total_discovered = len(everything)
    yield sse("crawl-done", {"totalPages": len(targets), "totalDiscovered": total_discovered})

    total = len(targets)
    events: asyncio.Queue[str | None] = asyncio.Queue()
    stats = {"completed": 0, "indexed": 0, "stored": 0}
    # Chunk hashes seen this run, so a footer repeated on every page is embedded
    # once. Safe to share: the check-and-add in clean_chunks has no await inside,
    # so the event loop can't interleave two pages mid-filter.
    seen: set[str] = set()
    embedder = OpenAIEmbedder()
    queue_iter = iter(enumerate(targets))

    async def process(client, i: int, url: str) -> None:
        category = url_category(url)
        await events.put(sse("page-start", {"current": min(stats["completed"] + 1, total), "total": total,
                                            "url": url, "category": category}))
        t0 = time.perf_counter()
        try:
            res = await client.get(url)
            page = await asyncio.to_thread(parse_html, res.text)  # lxml is CPU-bound: keep the loop free
            if res.status_code >= 400 or looks_like_error_page(page.title, page.text):
                stats["completed"] += 1
                await events.put(sse("page-done", {"current": stats["completed"], "total": total, "url": url,
                                                   "chunks": 0, "ms": _ms(t0), "recordsStored": stats["stored"],
                                                   "skipped": True}))
                return
            chunks = clean_chunks(page.chunks, seen)
            if chunks:
                vectors = await embedder.embed([c.content for c in chunks])  # one batched call per page
                meta = {"source": url, "category": category, "title": page.title,
                        "pageType": detect_page_type(url, page.title), "description": page.description,
                        "lang": page.lang, "lastCrawledAt": datetime.now(UTC).isoformat()}
                records = [
                    VectorRecord(namespace=namespace, type="faq" if c.section_type == "faq" else "text",
                                 content=c.content, embedding=v, content_hash=content_hash(c.content),
                                 section_type=c.section_type, heading_path=c.heading_path,
                                 source=url, title=page.title, metadata=meta)
                    for c, v in zip(chunks, vectors, strict=True)
                ]
                async with SessionLocal() as db:  # workers run concurrently: one session each
                    await PgVectorStore(db).upsert(records)
                stats["stored"] += len(records)
                stats["indexed"] += 1
            stats["completed"] += 1
            log.info("page %d/%d ✓ %d chunks in %dms — %s", i + 1, total, len(chunks), _ms(t0), url)
            await events.put(sse("page-done", {"current": stats["completed"], "total": total, "url": url,
                                               "chunks": len(chunks), "ms": _ms(t0),
                                               "recordsStored": stats["stored"]}))
        except Exception as exc:
            stats["completed"] += 1
            log.warning("page %d/%d ✗ %s — %s", i + 1, total, url, exc)
            await events.put(sse("page-error", {"current": stats["completed"], "total": total, "url": url,
                                                "error": str(exc) or type(exc).__name__}))

    async def worker(client) -> None:
        for i, url in queue_iter:  # shared iterator = shared work queue
            await process(client, i, url)

    async def run_pool() -> None:
        try:
            async with crawler.http_client() as client:
                await asyncio.gather(*(worker(client) for _ in range(min(INDEX_CONCURRENCY, total))))
        finally:
            await events.put(None)

    pool = asyncio.create_task(run_pool())
    try:
        while (event := await events.get()) is not None:
            yield event
        await pool  # re-raise a pool-level failure
        log.info("indexing done — pages=%d records=%d", stats["indexed"], stats["stored"])
        yield sse("done", {"success": True, "namespace": namespace,
                           "pagesIndexed": stats["indexed"], "recordsStored": stats["stored"]})
    except Exception as exc:
        log.exception("indexing failed")
        yield sse("error", {"error": str(exc)})
    finally:
        # Client closed the tab / pressed cancel: Starlette cancels this
        # generator, and we stop paying for embeddings nobody will use.
        if not pool.done():
            log.warning("client disconnected — aborting indexing for %s", base_url)
            pool.cancel()


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


# ─── Files + raw text ─────────────────────────────────────────────────────────


async def _owned_namespace(db, user_id: str, namespace: str) -> None:
    # The Express version let any signed-in user write into ANY namespace.
    if not await db.scalar(select(Chatbot.id).where(Chatbot.embed_token == namespace, Chatbot.user_id == user_id)):
        raise AppError("Chatbot not found", 404)


async def _index_plain_text(db, namespace: str, text: str, *, type_: str, hash_prefix: str, source: str | None,
                            title: str | None, metadata: dict) -> int:
    chunks = split_text(collapse_ws(text))
    if not chunks:
        return 0
    vectors = await OpenAIEmbedder().embed(chunks)
    await PgVectorStore(db).upsert([
        VectorRecord(namespace=namespace, type=type_, content=c, embedding=v, content_hash=sha256(f"{hash_prefix}:{i}"),
                     source=source, title=title, metadata=metadata)
        for i, (c, v) in enumerate(zip(chunks, vectors, strict=True))
    ])
    return len(chunks)


@router.post("/scrape/file")
async def scrape_file(
    user: CurrentUser, db: DB, namespace: Annotated[str, Form()], file: Annotated[UploadFile, File()]
):
    await _owned_namespace(db, user.id, namespace)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise AppError("File too large (max 20MB)", 413)
    name = file.filename or "upload"
    try:
        text = await asyncio.to_thread(extract_text, data, name, file.content_type)
    except UnsupportedFile as exc:
        raise AppError("Unsupported file type", 415) from exc
    except Exception as exc:
        raise AppError(f"Failed to parse {name.rsplit('.', 1)[-1].upper()}", 422) from exc
    if not text.strip():
        raise AppError("File appears to be empty", 422)
    stored = await _index_plain_text(db, namespace, text, type_="document", hash_prefix=f"file:{name}",
                                     source=name, title=name, metadata={"source": name, "fileType": file.content_type})
    return {"success": True, "recordsStored": stored}


class TextIn(BaseModel):
    namespace: str
    text: str
    source: str | None = None


@router.post("/scrape/text")
async def scrape_text(body: TextIn, user: CurrentUser, db: DB):
    await _owned_namespace(db, user.id, body.namespace)
    if not body.text.strip():
        raise AppError("text is required", 400)
    stored = await _index_plain_text(db, body.namespace, body.text, type_="text",
                                     hash_prefix=f"text-manual:{body.source or body.namespace}",
                                     source=body.source, title=None, metadata={"source": body.source or "manual"})
    return {"success": True, "recordsStored": stored}
