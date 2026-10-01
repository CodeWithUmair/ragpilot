"""app.api.billing: webhook signature + status->plan mapping."""

import hashlib
import hmac

import httpx
import pytest

from app.api.billing import plan_for_status, signature_valid
from app.core.config import get_settings
from app.main import app

SECRET = "whsec_test"
BODY = b'{"meta":{"event_name":"subscription_created"}}'


def sign(body: bytes) -> str:
    return hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


@pytest.mark.parametrize(
    ("status", "plan"),
    [("active", "pro"), ("on_trial", "pro"), ("past_due", "pro"), ("cancelled", "pro"),
     ("expired", "free"), ("unpaid", "free"), ("paused", "free"), (None, "free")],
)
def test_plan_for_status(status, plan):
    assert plan_for_status(status) == plan


def test_signature_valid():
    assert signature_valid(SECRET, BODY, sign(BODY))
    assert not signature_valid(SECRET, BODY, sign(b"other"))
    assert not signature_valid(SECRET, BODY, None)


async def test_webhook_rejects_bad_signature(monkeypatch):
    monkeypatch.setattr(get_settings(), "lemonsqueezy_webhook_secret", SECRET)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post("/api/billing/webhook", content=BODY, headers={"X-Signature": "nope"})
    assert res.status_code == 401
