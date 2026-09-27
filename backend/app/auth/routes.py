"""Auth endpoints speaking the Better Auth wire protocol, so the frontend's
`better-auth/react` client (signIn.email, signUp.email, useSession, signOut,
sendVerificationEmail) works unchanged.

Cross-domain design: the dashboard and API live on different origins, so no
cookies — the signed session token comes back in a `set-auth-token` header
(or the OAuth redirect fragment) and returns as `Authorization: Bearer …`.
"""

import secrets
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.auth import service
from app.auth.deps import DB
from app.auth.security import read_verify_email_token, verify_password
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Account, User

router = APIRouter(tags=["auth"])

MIN_PASSWORD = 8
MAX_PASSWORD = 128
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
OAUTH_STATE_COOKIE = "rp_oauth_state"


class SignUpBody(BaseModel):
    email: str
    password: str
    name: str
    callbackURL: str | None = None  # noqa: N815 — wire field name


class SignInBody(BaseModel):
    email: str
    password: str
    callbackURL: str | None = None  # noqa: N815


class ResendBody(BaseModel):
    email: str
    callbackURL: str | None = None  # noqa: N815


def _with_token(body: dict, signed_token: str | None, status: int = 200) -> JSONResponse:
    res = JSONResponse(body, status_code=status)
    if signed_token:
        res.headers["set-auth-token"] = signed_token
    return res


def _check_email(email: str) -> str:
    email = email.strip().lower()
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise AppError("Invalid email", 400, "INVALID_EMAIL")
    return email


@router.post("/api/auth/sign-up/email")
async def sign_up(body: SignUpBody, request: Request, db: DB):
    s = get_settings()
    email = _check_email(body.email)
    if len(body.password) < MIN_PASSWORD:
        raise AppError("Password too short", 400, "PASSWORD_TOO_SHORT")
    if len(body.password) > MAX_PASSWORD:
        raise AppError("Password too long", 400, "PASSWORD_TOO_LONG")
    if await db.scalar(select(User.id).where(User.email == email)):
        raise AppError("User already exists. Use another email.", 422, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")

    user = await service.create_user(
        db, email=email, name=body.name.strip(), password=body.password,
        email_verified=not s.require_email_verification,
    )
    await db.commit()

    if s.require_email_verification:
        await service.send_verification_email(user, body.callbackURL)
        return {"token": None, "user": service.user_json(user)}
    token = await service.create_session(db, user, request)
    return _with_token({"token": token, "user": service.user_json(user)}, token)


@router.post("/api/auth/sign-in/email")
async def sign_in(body: SignInBody, request: Request, db: DB):
    s = get_settings()
    email = _check_email(body.email)
    user = await db.scalar(select(User).where(User.email == email))
    account = user and await db.scalar(
        select(Account).where(Account.user_id == user.id, Account.provider_id == "credential")
    )
    if not user or not account or not account.password or not verify_password(body.password, account.password):
        raise AppError("Invalid email or password", 401, "INVALID_EMAIL_OR_PASSWORD")
    if s.require_email_verification and not user.email_verified:
        # The UI tells the user a fresh link is on its way.
        await service.send_verification_email(user, f"{s.app_url}/auth/verified")
        raise AppError("Email not verified", 403, "EMAIL_NOT_VERIFIED")

    token = await service.create_session(db, user, request)
    return _with_token({"redirect": False, "token": token, "url": None, "user": service.user_json(user)}, token)


@router.get("/api/auth/get-session")
async def get_session(request: Request, db: DB):
    resolved = await service.resolve_session(db, request)
    if not resolved:
        return JSONResponse(None)
    session, user = resolved
    return {"session": service.session_json(session), "user": service.user_json(user)}


@router.post("/api/auth/sign-out")
async def sign_out(request: Request, db: DB):
    await service.delete_session(db, request)
    return {"success": True}


@router.post("/api/auth/send-verification-email")
async def resend_verification(body: ResendBody, db: DB):
    user = await db.scalar(select(User).where(User.email == body.email.strip().lower()))
    # Same answer whether or not the account exists (no email enumeration).
    if user and not user.email_verified:
        await service.send_verification_email(user, body.callbackURL)
    return {"status": True}


@router.get("/api/auth/verify-email")
async def verify_email(token: str, db: DB, callbackURL: str | None = None):  # noqa: N803
    email = read_verify_email_token(token)
    user = email and await db.scalar(select(User).where(User.email == email))
    if not user:
        if callbackURL:
            sep = "&" if "?" in callbackURL else "?"
            return RedirectResponse(f"{callbackURL}{sep}error=invalid_token", status_code=302)
        raise AppError("Invalid or expired token", 401, "INVALID_TOKEN")
    user.email_verified = True
    await db.commit()
    return RedirectResponse(callbackURL, status_code=302) if callbackURL else {"status": True}


# ─── Google OAuth ─────────────────────────────────────────────────────────────
# Started by a TOP-LEVEL navigation (not fetch), so the state cookie is
# first-party on the API domain and survives browsers that block third-party
# cookies (Safari, Brave). The callback path matches Better Auth's, so the
# redirect URI already registered in Google Cloud keeps working.


def _redirect_uri() -> str:
    return f"{get_settings().api_url}/api/auth/callback/google"


def _to_app(fragment: str) -> RedirectResponse:
    res = RedirectResponse(f"{get_settings().app_url}/auth/callback#{fragment}", status_code=302)
    res.delete_cookie(OAUTH_STATE_COOKIE, path="/api/auth/callback")
    return res


@router.get("/api/login/google")
async def google_start():
    s = get_settings()
    if not s.google_client_id or not s.google_client_secret:
        return _to_app("error=oauth_init")
    state = secrets.token_urlsafe(24)
    params = {
        "client_id": s.google_client_id, "redirect_uri": _redirect_uri(), "response_type": "code",
        "scope": "openid email profile", "state": state, "prompt": "select_account",
    }
    res = RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)
    res.set_cookie(OAUTH_STATE_COOKIE, state, max_age=600, httponly=True, secure=s.is_production,
                   samesite="lax", path="/api/auth/callback")
    return res


@router.get("/api/auth/callback/google")
async def google_callback(request: Request, db: DB, code: str | None = None, state: str | None = None):
    s = get_settings()
    expected = request.cookies.get(OAUTH_STATE_COOKIE)
    if not code or not state or not expected or not secrets.compare_digest(state, expected):
        return _to_app("error=state_mismatch")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            tokens = (await client.post(GOOGLE_TOKEN_URL, data={
                "code": code, "client_id": s.google_client_id, "client_secret": s.google_client_secret,
                "redirect_uri": _redirect_uri(), "grant_type": "authorization_code",
            })).raise_for_status().json()
            info = (await client.get(
                GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {tokens['access_token']}"}
            )).raise_for_status().json()
    except (httpx.HTTPError, KeyError):
        return _to_app("error=oauth_exchange")

    sub, email = info.get("sub"), (info.get("email") or "").lower()
    if not sub or not email or not info.get("email_verified"):
        return _to_app("error=email_unverified")

    account = await db.scalar(select(Account).where(Account.provider_id == "google", Account.account_id == sub))
    user = await db.get(User, account.user_id) if account else None
    if not user:
        user = await db.scalar(select(User).where(User.email == email))
        if not user:
            user = await service.create_user(db, email=email, name=info.get("name") or email.split("@")[0],
                                             password=None, email_verified=True, image=info.get("picture"))
        user.email_verified = True  # Google vouched for this address
        db.add(Account(account_id=sub, provider_id="google", user_id=user.id,
                       access_token=tokens.get("access_token"), id_token=tokens.get("id_token"),
                       scope=tokens.get("scope")))
        await db.commit()

    token = await service.create_session(db, user, request)
    return _to_app(f"token={quote(token, safe='')}")
