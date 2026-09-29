"""Per-IP rate limiting for public endpoints — a message quota already caps a
signed-up owner's usage (see ARCHITECTURE.md#5), but nothing stopped an
anonymous caller from burning OpenAI credit or spamming signups before an
owner even exists to be quota-limited.

Disabled outside production, same convention as the SSRF guard in `net.py`
("Disabled outside production so you can crawl localhost") — otherwise the
integration suite's many legitimate `signup()`/chat calls from one shared
test-client "IP" trip it immediately. `check()` itself has no such gate and
is unit-tested directly (tests/test_rate_limit.py) so the actual counting
logic still has real coverage.

ponytail: in-memory, single-process fixed-window counters — state resets on
restart and isn't shared across horizontally-scaled instances. Fine for the
one DigitalOcean App Platform instance this runs on today. Upgrade path: a
Postgres- or Redis-backed counter if this ever runs as more than one process.
"""

import time
from collections import defaultdict
from collections.abc import Awaitable, Callable

from fastapi import Request

from app.auth.service import client_ip
from app.core.config import get_settings
from app.core.errors import AppError

_hits: dict[str, list[float]] = defaultdict(list)


def check(bucket_key: str, max_requests: int, window_seconds: int) -> None:
    """At most `max_requests` per `window_seconds` per bucket_key. Raises 429
    once the window is full. No environment gate — always real, so it can be
    unit-tested directly; the FastAPI dependency below is what skips outside
    production."""
    bucket = _hits[bucket_key]
    now = time.monotonic()
    cutoff = now - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)
    if len(bucket) >= max_requests:
        raise AppError("Too many requests — please slow down and try again shortly.", 429, "RATE_LIMITED")
    bucket.append(now)


def rate_limit(key: str, max_requests: int, window_seconds: int) -> Callable[[Request], Awaitable[None]]:
    """FastAPI dependency: at most `max_requests` per `window_seconds` per
    (client IP, key), enforced in production only."""

    async def dependency(request: Request) -> None:
        if not get_settings().is_production:
            return
        check(f"{key}:{client_ip(request) or 'unknown'}", max_requests, window_seconds)

    return dependency
