"""Users, sessions and email verification."""

import html
import logging
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from fastapi import Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import (
    create_verify_email_token,
    hash_password,
    new_session_token,
    sign_token,
    unsign_token,
)
from app.core.config import get_settings
from app.db.models import Account, Session, User
from app.services.email import send_email

log = logging.getLogger("ragpilot.auth")

SESSION_TTL = timedelta(days=7)
SESSION_REFRESH_AFTER = timedelta(days=1)  # slide the expiry at most once a day
SESSION_COOKIES = ("__Secure-better-auth.session_token", "better-auth.session_token")


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


async def create_user(db: AsyncSession, *, email: str, name: str, password: str | None,
                      email_verified: bool, image: str | None = None) -> User:
    user = User(email=email.lower(), name=name, email_verified=email_verified, image=image)
    db.add(user)
    await db.flush()
    if password is not None:
        db.add(Account(account_id=user.id, provider_id="credential", user_id=user.id,
                       password=hash_password(password)))
    return user


async def create_session(db: AsyncSession, user: User, request: Request) -> str:
    """Persists a session and returns the SIGNED token clients send back."""
    token = new_session_token()
    db.add(Session(
        token=token, user_id=user.id, expires_at=datetime.now(UTC) + SESSION_TTL,
        ip_address=client_ip(request), user_agent=request.headers.get("user-agent"),
    ))
    await db.commit()
    return sign_token(token)


def token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer ") and auth[7:].strip():
        return auth[7:].strip()
    for name in SESSION_COOKIES:
        if value := request.cookies.get(name):
            return value
    return None


async def resolve_session(db: AsyncSession, request: Request) -> tuple[Session, User] | None:
    raw = token_from_request(request)
    token = unsign_token(raw) if raw else None
    if not token:
        return None
    row = (await db.execute(
        select(Session, User).join(User, User.id == Session.user_id).where(Session.token == token)
    )).first()
    if not row:
        return None
    session, user = row
    now = datetime.now(UTC)
    if session.expires_at <= now:
        await db.delete(session)
        await db.commit()
        return None
    if session.expires_at - now < SESSION_TTL - SESSION_REFRESH_AFTER:
        session.expires_at = now + SESSION_TTL
        await db.commit()
    return session, user


async def delete_session(db: AsyncSession, request: Request) -> None:
    raw = token_from_request(request)
    if raw and (token := unsign_token(raw)):
        await db.execute(delete(Session).where(Session.token == token))
        await db.commit()


def _verify_email_html(url: str, name: str) -> str:
    brand = html.escape(get_settings().email_from_name)
    return f"""
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;color:#111;">Hi {html.escape(name or "there")},</h2>
      <p style="color:#444;line-height:1.55;">Welcome to {brand}! Click the button below to verify your email
        and finish setting up your account.</p>
      <p style="margin:24px 0;"><a href="{url}" style="background:#6B46C1;color:white;text-decoration:none;
        padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block;">Verify my email</a></p>
      <p style="color:#888;font-size:12px;line-height:1.5;">If the button doesn't work, paste this link into
        your browser:<br /><a href="{url}" style="color:#6B46C1;word-break:break-all;">{url}</a></p>
    </div>"""


async def send_verification_email(user: User, callback_url: str | None) -> None:
    s = get_settings()
    url = f"{s.api_url}/api/auth/verify-email?token={create_verify_email_token(user.email)}"
    if callback_url:
        url += f"&callbackURL={quote(callback_url, safe='')}"
    try:
        await send_email(user.email, f"Verify your email for {s.email_from_name}", _verify_email_html(url, user.name))
    except Exception:
        # Never block signup on SMTP; log the link so it can be verified by hand.
        log.exception("verification email failed — link: %s", url)


def user_json(user: User) -> dict:
    return {
        "id": user.id, "name": user.name, "email": user.email, "emailVerified": user.email_verified,
        "image": user.image, "createdAt": user.created_at.isoformat(), "updatedAt": user.updated_at.isoformat(),
        "plan": user.plan, "messageUsage": user.message_usage, "messageLimit": user.message_limit,
    }


def session_json(session: Session) -> dict:
    return {
        "id": session.id, "token": session.token, "userId": session.user_id,
        "expiresAt": session.expires_at.isoformat(), "createdAt": session.created_at.isoformat(),
        "updatedAt": session.updated_at.isoformat(), "ipAddress": session.ip_address,
        "userAgent": session.user_agent,
    }
