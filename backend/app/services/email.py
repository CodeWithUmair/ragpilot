"""Outbound email. Transport priority: Resend API → Gmail SMTP → generic SMTP →
log to console (dev). Outside production every send is also captured in memory
so E2E tests can read verification links via GET /api/__test/emails, and
recipients on test domains never reach a real transport."""

import logging
from collections import deque
from datetime import UTC, datetime
from email.message import EmailMessage

import aiosmtplib
import httpx

from app.core.config import get_settings

log = logging.getLogger("ragpilot.email")

_captured: deque[dict] = deque(maxlen=100)
_TEST_DOMAINS = (".test", ".invalid", ".example")


def _is_test_recipient(to: str) -> bool:
    domain = to.rsplit("@", 1)[-1].lower()
    return domain.endswith(_TEST_DOMAINS) or domain in ("example.com", "ragbot.dev")


def captured_emails(to: str | None = None) -> list[dict]:
    items = [e for e in _captured if not to or e["to"].lower() == to.lower()]
    return list(reversed(items))


def transport_kind() -> str:
    s = get_settings()
    if s.resend_api_key:
        return "resend"
    if s.gmail_user and s.gmail_app_password:
        return "gmail"
    if s.smtp_host and s.smtp_user and s.smtp_pass:
        return "smtp"
    return "none"


async def send_email(to: str, subject: str, html: str) -> None:
    s = get_settings()
    if not s.is_production:
        _captured.append({"to": to, "subject": subject, "html": html, "sentAt": datetime.now(UTC).isoformat()})
        if _is_test_recipient(to):
            log.info("captured for e2e (no real send): %s — %s", to, subject)
            return

    kind = transport_kind()
    if kind == "none":
        log.warning("no email transport configured — would have sent to=%s subject=%s", to, subject)
        return

    if kind == "resend":
        sender = s.email_from or "onboarding@resend.dev"
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {s.resend_api_key}"},
                json={"from": f"{s.email_from_name} <{sender}>", "to": [to], "subject": subject, "html": html},
            )
        if res.status_code >= 400:
            raise RuntimeError(f"Resend API {res.status_code}: {res.text[:300]}")
        return

    if kind == "gmail":
        host, port, user, password = "smtp.gmail.com", 587, s.gmail_user, s.gmail_app_password
    else:
        host, port, user, password = s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_pass
    msg = EmailMessage()
    msg["From"] = f'"{s.email_from_name}" <{s.email_from or user}>'
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content("This email requires an HTML-capable client.")
    msg.add_alternative(html, subtype="html")
    await aiosmtplib.send(
        msg, hostname=host, port=port, username=user, password=password,
        use_tls=port == 465, start_tls=port != 465, timeout=20,
    )
