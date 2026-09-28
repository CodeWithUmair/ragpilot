"""Lead capture (from chat or the widget form) and forwarding to the owner's
destinations: email, a generic webhook (Zapier/Make/n8n), a Google Sheet via
an Apps Script web app. Forwarding is best-effort: a failing destination is
logged and never breaks the visitor's chat."""

import asyncio
import html
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import Lead
from app.db.session import SessionLocal
from app.lib.contact_extract import ExtractedContact
from app.lib.lead_config import PRIORITY_RANK, resolve_lead_config
from app.lib.net import safe_client
from app.services.email import send_email

log = logging.getLogger("ragpilot.leads")

# Keeps fire-and-forget tasks referenced until they finish (asyncio only holds weak refs).
_background: set[asyncio.Task] = set()


def run_in_background(coro) -> None:
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


def clean(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


@dataclass
class LeadOwner:
    """What forwarding needs to know about the chatbot and its owner."""

    chatbot_id: str
    chatbot_name: str
    lead_config: Any
    owner_email: str | None


# ─── Capture ─────────────────────────────────────────────────────────────────


async def capture_chat_lead(
    db: AsyncSession, *, chatbot_id: str, namespace: str, session_id: str | None, visitor_id: str | None,
    host_page_url: str | None, contact: ExtractedContact, priority: str = "COLD",
) -> tuple[Lead, bool] | None:
    """One lead per chat session: later turns enrich it instead of duplicating.
    Returns (lead, is_new), or None when there is no handle to create one with.
    Priority is upgrade-only (COLD < WARM < HOT) — a calmer later message must
    not erase urgency the visitor already showed earlier in the conversation."""
    sid = clean(session_id)
    existing = (
        await db.scalar(select(Lead).where(Lead.chatbot_id == chatbot_id, Lead.session_id == sid)) if sid else None
    )
    fields = {k: clean(getattr(contact, k)) for k in ("name", "email", "phone", "company")}
    if existing is None and not (fields["email"] or fields["phone"]):
        return None
    if existing:
        # Only overwrite with newly provided values — a turn without a name must
        # not wipe the name we already have.
        for key, value in fields.items():
            if value:
                setattr(existing, key, value)
        if PRIORITY_RANK.get(priority, 0) > PRIORITY_RANK.get(existing.priority, 0):
            existing.priority = priority
        await db.commit()
        return existing, False
    lead = Lead(
        chatbot_id=chatbot_id, namespace=namespace, session_id=sid, visitor_id=clean(visitor_id),
        source=clean(host_page_url), priority=priority, **fields,
    )
    db.add(lead)
    await db.commit()
    return lead, True


async def session_contact(db: AsyncSession, chatbot_id: str, session_id: str | None) -> ExtractedContact:
    sid = clean(session_id)
    if not sid:
        return ExtractedContact()
    lead = await db.scalar(select(Lead).where(Lead.chatbot_id == chatbot_id, Lead.session_id == sid))
    if not lead:
        return ExtractedContact()
    return ExtractedContact(name=lead.name, email=lead.email, phone=lead.phone, company=lead.company)


class DbLeadStore:
    """The chat graph's LeadStore, backed by the database. New leads that carry
    a real handle are forwarded to the owner exactly once."""

    def __init__(self, db: AsyncSession, owner: LeadOwner, *, namespace: str, session_id: str,
                 visitor_id: str, host_page_url: str | None):
        self.db, self.owner = db, owner
        self.namespace, self.session_id = namespace, session_id
        self.visitor_id, self.host_page_url = visitor_id, host_page_url

    async def known_contact(self) -> ExtractedContact:
        return await session_contact(self.db, self.owner.chatbot_id, self.session_id)

    async def capture(self, contact: ExtractedContact, *, priority: str = "COLD") -> None:
        try:
            result = await capture_chat_lead(
                self.db, chatbot_id=self.owner.chatbot_id, namespace=self.namespace, session_id=self.session_id,
                visitor_id=self.visitor_id, host_page_url=self.host_page_url, contact=contact, priority=priority,
            )
        except Exception:
            log.exception("auto-capture lead failed")
            await self.db.rollback()
            return
        if result and result[1] and (result[0].email or result[0].phone):
            run_in_background(forward_lead(result[0].id, self.owner))


# ─── Forwarding ──────────────────────────────────────────────────────────────


def _lead_payload(lead: Lead | dict, owner: LeadOwner) -> dict:
    get = (lambda k: lead.get(k)) if isinstance(lead, dict) else (lambda k: getattr(lead, k))
    created = get("created_at")
    return {
        "id": get("id"),
        "name": get("name") or "", "email": get("email") or "", "phone": get("phone") or "",
        "company": get("company") or "", "message": get("message") or "", "source": get("source") or "",
        "status": get("status"), "priority": get("priority"), "chatbotId": owner.chatbot_id,
        "chatbot": owner.chatbot_name,
        "createdAt": created.isoformat() if created else None,
    }


def _lead_text(p: dict, chatbot_name: str) -> str:
    """Short plain-text summary for chat-app destinations (Slack/Discord/Telegram)
    — those expect a message, not the raw lead JSON the webhook/sheet destinations
    get (Phase 3a of docs/AGENT_VISION.md)."""
    lines = [f"New lead from {chatbot_name}"]
    for label, key in (("Priority", "priority"), ("Name", "name"), ("Email", "email"),
                       ("Phone", "phone"), ("Company", "company"), ("Message", "message")):
        if p.get(key):
            lines.append(f"{label}: {p[key]}")
    return "\n".join(lines)


def _lead_email_html(p: dict, chatbot_name: str) -> str:
    rows = "".join(
        f'<tr><td style="padding:6px 14px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;'
        f'vertical-align:top;">{label}</td><td style="padding:6px 0;color:#111827;font-size:14px;">'
        f"{html.escape(str(p[key]))}</td></tr>"
        for label, key in (("Priority", "priority"), ("Name", "name"), ("Email", "email"), ("Phone", "phone"),
                           ("Company", "company"), ("Message", "message"), ("Page", "source"))
        if p.get(key)
    )
    dashboard = f"{get_settings().app_url}/dashboard/leads"
    return f"""
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 4px;color:#111;">New lead from {html.escape(chatbot_name)}</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 18px;">Captured by your chatbot just now.</p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;">{rows}</table>
      <p style="margin:20px 0 0;"><a href="{dashboard}" style="background:#6B46C1;color:#fff;text-decoration:none;
        padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block;font-size:14px;">
        View in dashboard</a></p>
    </div>"""


class NotPublic(Exception):
    pass


async def _post_json(url: str, payload: dict) -> None:
    async with safe_client(timeout=10) as client:
        res = await client.post(url, json=payload)
    # A non-public Apps Script redirects to Google sign-in and answers 200 with
    # HTML — a silent failure where no row is written. Surface it.
    if re.search(r"accounts\.google\.com|/ServiceLogin", str(res.url), re.I):
        raise NotPublic()
    if res.status_code >= 400:
        raise RuntimeError(f"HTTP {res.status_code}")


async def forward_lead(lead_id: str, owner: LeadOwner) -> None:
    """Fire-and-forget; uses its own DB session because the request's is gone."""
    config = resolve_lead_config(owner.lead_config)
    async with SessionLocal() as db:
        lead = await db.get(Lead, lead_id)
        if not lead:
            return
        payload = _lead_payload(lead, owner)
        delivered: list[str] = []
        if config["notifyEmail"] and owner.owner_email:
            try:
                subject = f"New lead from {owner.chatbot_name}" + (f" — {lead.name}" if lead.name else "")
                await send_email(owner.owner_email, subject, _lead_email_html(payload, owner.chatbot_name))
                delivered.append("email")
            except Exception as exc:
                log.error("owner email failed: %s", exc)
        for name, url in (("webhook", config["webhookUrl"]), ("sheet", config["sheetUrl"])):
            if not url:
                continue
            try:
                await _post_json(url, payload)
                delivered.append(name)
            except Exception as exc:
                log.error("%s forward failed: %r", name, exc)

        text = _lead_text(payload, owner.chatbot_name)
        for name, url, body in (
            ("slack", config["slackWebhookUrl"], {"text": text}),
            ("discord", config["discordWebhookUrl"], {"content": text}),
        ):
            if not url:
                continue
            try:
                await _post_json(url, body)
                delivered.append(name)
            except Exception as exc:
                log.error("%s forward failed: %r", name, exc)
        if config["telegramBotToken"] and config["telegramChatId"]:
            try:
                await _post_json(
                    f"https://api.telegram.org/bot{config['telegramBotToken']}/sendMessage",
                    {"chat_id": config["telegramChatId"], "text": text},
                )
                delivered.append("telegram")
            except Exception as exc:
                log.error("telegram forward failed: %r", exc)

        if delivered:
            await db.execute(update(Lead).where(Lead.id == lead_id).values(synced_at=datetime.now(UTC)))
            await db.commit()
        log.info("lead %s forwarded → [%s]", lead_id, ", ".join(delivered) or "none")


def _workspace_domain(url: str) -> str | None:
    """`/a/macros/<domain>/` = an org-restricted Workspace deployment, which an
    anonymous server POST can never reach no matter how it is re-deployed."""
    m = re.search(r"script\.google\.com/a/macros/([^/]+)/", url, re.I)
    return m.group(1) if m else None


async def send_test_lead(owner: LeadOwner, destination: str, url_override: str | None) -> dict:
    config = resolve_lead_config(owner.lead_config)
    sample = {
        "id": "test-lead", "name": "Test Lead", "email": "test-lead@example.com", "phone": "+1 555 0100",
        "company": "Acme Inc", "message": "This is a test lead sent from your dashboard to verify the connection.",
        "source": "dashboard-test", "status": "NEW", "priority": "WARM", "created_at": datetime.now(UTC),
    }
    payload = _lead_payload(sample, owner)
    try:
        if destination == "email":
            if not owner.owner_email:
                return {"ok": False, "error": "No owner email on file"}
            await send_email(owner.owner_email, f"[Test] New lead from {owner.chatbot_name}",
                             _lead_email_html(payload, owner.chatbot_name))
            return {"ok": True}

        if destination == "telegram":
            token, chat_id = config["telegramBotToken"], config["telegramChatId"]
            if not (token and chat_id):
                return {"ok": False, "error": "Add both a bot token and a chat ID first"}
            await _post_json(f"https://api.telegram.org/bot{token}/sendMessage",
                             {"chat_id": chat_id, "text": f"[Test] {_lead_text(payload, owner.chatbot_name)}"})
            return {"ok": True}

        url = (url_override or "").strip() or {
            "webhook": config["webhookUrl"], "sheet": config["sheetUrl"],
            "slack": config["slackWebhookUrl"], "discord": config["discordWebhookUrl"],
        }.get(destination, "")
        if not url:
            return {"ok": False, "error": "No URL configured yet — paste your URL first"}
        if not url.lower().startswith("https://"):
            return {"ok": False, "error": "URL must start with https://"}
        if domain := _workspace_domain(url):
            return {"ok": False, "error": (
                f"This Apps Script is published under your Google Workspace ({domain}), which restricts it to "
                f"people signed into {domain}. Our server can't reach it. Fix: create the Sheet + Apps Script with "
                "a personal @gmail.com account and re-deploy — the URL will look like "
                "script.google.com/macros/s/…/exec "
                f"(no “/a/macros/{domain}/”). Alternatively, ask your Workspace admin to allow Apps Script web apps "
                "to be shared with “Anyone”."
            )}
        if destination == "slack":
            body = {"text": f"[Test] {_lead_text(payload, owner.chatbot_name)}"}
        elif destination == "discord":
            body = {"content": f"[Test] {_lead_text(payload, owner.chatbot_name)}"}
        else:
            body = {**payload, "test": True}
        await _post_json(url, body)
        return {"ok": True}
    except NotPublic:
        return {"ok": False, "error": (
            "Google asked for sign-in, so the web app isn’t public. Re-deploy with “Who has access: Anyone” "
            "(not “Anyone with Google account”), and make sure you created a NEW version."
        )}
    except httpx.HTTPError as exc:
        return {"ok": False, "error": str(exc) or "Request failed"}
    except Exception as exc:
        raw = str(exc) or "Request failed"
        if re.fullmatch(r"HTTP 40[13]", raw):
            return {"ok": False, "error": raw + (
                " — the web app rejected an anonymous request. Re-deploy with “Who has access: Anyone” and a NEW "
                "version. If your URL contains “/a/macros/…”, it’s a Workspace account — use a personal Gmail instead."
            )}
        return {"ok": False, "error": raw}
