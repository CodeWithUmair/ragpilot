"""Credential primitives, byte-compatible with Better Auth (the Node library
the original backend used), so existing users' passwords and live sessions
keep working against this backend:

  password hash  "<16-byte salt as hex>:<scrypt(N=16384, r=16, p=1, dkLen=64) as hex>",
                 password NFKC-normalised, the salt's HEX STRING used as the salt bytes.
  session token  32 random chars; handed to clients signed as "<token>.<b64 HMAC-SHA256>".
  verify email   HS256 JWT {"email": ...} valid for one hour.
"""

import base64
import hashlib
import hmac
import secrets
import unicodedata
from datetime import UTC, datetime, timedelta
from urllib.parse import unquote

import jwt

from app.core.config import get_settings

_SCRYPT = {"n": 16384, "r": 16, "p": 1, "dklen": 64, "maxmem": 64 * 1024 * 1024}
VERIFY_EMAIL_TTL = timedelta(hours=1)


def _scrypt(password: str, salt: str) -> bytes:
    return hashlib.scrypt(unicodedata.normalize("NFKC", password).encode(), salt=salt.encode(), **_SCRYPT)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    return f"{salt}:{_scrypt(password, salt).hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt, _, key = stored.partition(":")
    if not salt or not key:
        return False
    return hmac.compare_digest(_scrypt(password, salt).hex(), key)


def new_session_token() -> str:
    return secrets.token_urlsafe(24)[:32]


def _signature(token: str) -> str:
    digest = hmac.new(get_settings().auth_secret.encode(), token.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def sign_token(token: str) -> str:
    return f"{token}.{_signature(token)}"


def unsign_token(value: str) -> str | None:
    """Accepts a signed token (optionally URL-encoded, as cookies carry it) or
    a bare one. Returns the raw token, or None if the signature is wrong."""
    value = unquote(value.strip())
    if "." not in value:
        return value or None
    token, _, signature = value.rpartition(".")
    # Better Auth sometimes strips base64 '=' padding from bearer values.
    expected = _signature(token)
    if hmac.compare_digest(signature.rstrip("="), expected.rstrip("=")):
        return token
    return None


def create_verify_email_token(email: str) -> str:
    payload = {"email": email.lower(), "iat": datetime.now(UTC), "exp": datetime.now(UTC) + VERIFY_EMAIL_TTL}
    return jwt.encode(payload, get_settings().auth_secret, algorithm="HS256")


def read_verify_email_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, get_settings().auth_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    email = payload.get("email")
    return email if isinstance(email, str) else None
