"""Pro subscription billing on Lemon Squeezy (hosted checkout + webhook).

Card details never touch this server: checkout and the cancel/update-card
portal are Lemon Squeezy pages. The webhook is the only thing that changes a
user's plan, so it is signature-verified and idempotent (it sets state from
the payload, it doesn't toggle).
"""

import hashlib
import hmac
import json
import logging

import httpx
from fastapi import APIRouter, Request

from app.auth.deps import DB, CurrentUser
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.db.models import User
from app.lib.plans import plan_for

log = logging.getLogger("ragpilot.billing")
router = APIRouter(prefix="/api", tags=["billing"])

LS_API = "https://api.lemonsqueezy.com/v1"
# "cancelled" still has paid time left (ends_at); Lemon Squeezy sends status
# "expired" when it actually ends. past_due is Lemon Squeezy's retry window.
PRO_STATUSES = {"on_trial", "active", "past_due", "cancelled"}


def plan_for_status(status: str | None) -> str:
    return "pro" if status in PRO_STATUSES else "free"


def signature_valid(secret: str, raw_body: bytes, header: str | None) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or "")


def _ls_headers(s: Settings) -> dict[str, str]:
    return {
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        "Authorization": f"Bearer {s.lemonsqueezy_api_key}",
    }


def _require_billing(s: Settings) -> None:
    if not (s.lemonsqueezy_api_key and s.lemonsqueezy_store_id and s.lemonsqueezy_pro_variant_id):
        raise AppError("Billing is not set up yet", 503)


@router.post("/billing/checkout")
async def create_checkout(user: CurrentUser):
    s = get_settings()
    _require_billing(s)
    if user.plan == "pro":
        raise AppError("You are already on Pro", 400)
    body = {"data": {
        "type": "checkouts",
        "attributes": {
            "product_options": {"redirect_url": f"{s.app_url}/dashboard/settings?upgraded=1"},
            "checkout_data": {"email": user.email, "custom": {"user_id": user.id}},
        },
        "relationships": {
            "store": {"data": {"type": "stores", "id": s.lemonsqueezy_store_id}},
            "variant": {"data": {"type": "variants", "id": s.lemonsqueezy_pro_variant_id}},
        },
    }}
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(f"{LS_API}/checkouts", headers=_ls_headers(s), json=body)
    if res.status_code != 201:
        log.error("checkout create failed: %s %s", res.status_code, res.text[:300])
        raise AppError("Could not start checkout. Please try again.", 502)
    return {"url": res.json()["data"]["attributes"]["url"]}


@router.get("/billing/portal")
async def billing_portal(user: CurrentUser, db: DB):
    """Link to Lemon Squeezy's customer portal (cancel, update card, invoices)."""
    s = get_settings()
    _require_billing(s)
    row = await db.get(User, user.id)
    if not row or not row.subscription_id:
        raise AppError("No subscription found for this account", 404)
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{LS_API}/subscriptions/{row.subscription_id}", headers=_ls_headers(s))
    if res.status_code != 200:
        log.error("portal lookup failed: %s %s", res.status_code, res.text[:300])
        raise AppError("Could not open the billing portal. Please try again.", 502)
    return {"url": res.json()["data"]["attributes"]["urls"]["customer_portal"]}


@router.post("/billing/webhook")
async def lemonsqueezy_webhook(request: Request, db: DB):
    secret = get_settings().lemonsqueezy_webhook_secret
    if not secret:
        raise AppError("Billing is not set up yet", 503)
    raw = await request.body()
    if not signature_valid(secret, raw, request.headers.get("X-Signature")):
        raise AppError("Invalid signature", 401)

    try:
        payload = json.loads(raw)
        event = payload["meta"]["event_name"]
        user_id = (payload["meta"].get("custom_data") or {}).get("user_id")
        sub_id = str(payload["data"]["id"])
        status = payload["data"]["attributes"]["status"]
    except (ValueError, KeyError, TypeError):
        raise AppError("Malformed webhook payload", 400) from None

    # Payment events carry an invoice, not the subscription; the subscription_*
    # lifecycle events are the ones that report the current status. Always answer
    # 200 for events we skip so Lemon Squeezy doesn't retry them.
    if not event.startswith("subscription_") or event.startswith("subscription_payment"):
        return {"received": True}
    user = await db.get(User, user_id) if user_id else None
    if not user:
        log.warning("webhook %s for unknown user %r (subscription %s)", event, user_id, sub_id)
        return {"received": True}

    plan = plan_for_status(status)
    user.subscription_id = sub_id
    user.plan, user.message_limit = plan, (await plan_for(db, plan))["messageLimit"]
    await db.commit()
    log.info("webhook %s: user %s -> %s (%s)", event, user.id, plan, status)
    return {"received": True}
