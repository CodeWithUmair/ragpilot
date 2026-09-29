"""app.lib.rate_limit — the in-memory per-IP limiter added for /api/chat,
/api/leads, /api/auth/sign-up/email (see docs/ROADMAP.md "Next").

`check()` has no environment gate (that's what's unit-tested here); the
FastAPI `rate_limit()` dependency skips outside production — same convention
as the SSRF guard in lib/net.py — so it's not exercised by these tests, only
by `check()` directly."""

import pytest

from app.core.errors import AppError
from app.lib.rate_limit import check, rate_limit


class FakeRequest:
    def __init__(self, ip: str = "1.2.3.4"):
        self.headers: dict[str, str] = {}
        self.client = type("Client", (), {"host": ip})()


def test_allows_up_to_the_limit_then_blocks():
    for _ in range(3):
        check("test-block", max_requests=3, window_seconds=60)
    with pytest.raises(AppError) as exc:
        check("test-block", max_requests=3, window_seconds=60)
    assert exc.value.status_code == 429
    assert exc.value.code == "RATE_LIMITED"


def test_different_keys_are_independent():
    check("test-key-a", max_requests=1, window_seconds=60)
    check("test-key-b", max_requests=1, window_seconds=60)  # different key — must not raise


async def test_dependency_is_a_noop_outside_production():
    # The test suite runs with APP_ENV unset (defaults to "development"), so
    # this must never block regardless of how low the limit is.
    dep = rate_limit("test-dependency-dev", max_requests=1, window_seconds=60)
    req = FakeRequest()
    await dep(req)
    await dep(req)
    await dep(req)  # would raise if the production gate were missing
