"""app.auth.security — including byte-compatibility with Better Auth (Node), so
passwords and session cookies issued by the old backend keep working."""

from datetime import timedelta
from urllib.parse import quote

import jwt
import pytest

from app.auth import security
from app.auth.security import (
    create_verify_email_token,
    hash_password,
    new_session_token,
    read_verify_email_token,
    sign_token,
    unsign_token,
    verify_password,
)
from app.core.config import get_settings

CONFTEST_SECRET = "test-secret-test-secret-test-secret"

# Generated with Node's built-in crypto, using Better Auth's exact recipe:
#   const key = crypto.scryptSync(pw.normalize('NFKC'), saltHex, 64, {N: 16384, r: 16, p: 1, maxmem})
#   `${saltHex}:${key.toString('hex')}`
NODE_HASH = (
    "0123456789abcdef0123456789abcdef:"
    "e1034727d858e2fca8a705fe561781100520e78064f8d2bfa492937c58df02eb"
    "15d40233f809f179c7fb9863b8eb9dc5a8d2dc196c0b9733c05fa426f224856e"
)
NODE_HASH_PASSWORD = "correct horse battery staple"
# Same recipe, password "Ｐａｓｓｗｏｒｄ１" (full-width), which NFKC-normalises to "Password1".
NODE_HASH_NFKC = (
    "ffdca6e7d1cec8fba4ef5922154552d7:"
    "2d0afc811fc74b232714747ef1699fabafa536f0591cfe6bbba4d594bff9dec1"
    "ab96208fc0a7b319ce6bce23091a11f851eca69862185d7bf236eb2e8f82217b"
)

# better-call's signed cookie, generated in Node with the conftest AUTH_SECRET:
#   sig = crypto.createHmac('sha256', secret).update(value).digest('base64')
#   encodeURIComponent(`${value}.${sig}`)
NODE_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
NODE_COOKIE = "AbCdEfGhIjKlMnOpQrStUvWxYz012345.M7%2BE0rhOwCa%2FN4uCUjlvhhLVJ1PSNJGWqSFRJellnA8%3D"


@pytest.fixture
def conftest_secret():
    if get_settings().auth_secret != CONFTEST_SECRET:
        pytest.skip("AUTH_SECRET is overridden in this environment; Node fixtures use the conftest value")


# --- passwords ----------------------------------------------------------------

def test_hash_verify_round_trip():
    stored = hash_password("s3cret-pass")
    salt, key = stored.split(":")
    assert len(salt) == 32 and len(key) == 128
    assert verify_password("s3cret-pass", stored)


def test_wrong_password_fails():
    stored = hash_password("s3cret-pass")
    assert not verify_password("s3cret-pasS", stored)
    assert not verify_password("", stored)


def test_hashes_are_salted():
    assert hash_password("same") != hash_password("same")


@pytest.mark.parametrize("stored", ["", "no-colon-here", ":abc", "abc:"])
def test_malformed_stored_hash_rejected(stored):
    assert not verify_password("anything", stored)


def test_accepts_better_auth_node_hash():
    assert verify_password(NODE_HASH_PASSWORD, NODE_HASH)
    assert not verify_password(NODE_HASH_PASSWORD + "!", NODE_HASH)


def test_nfkc_normalisation_matches_node():
    assert verify_password("Password1", NODE_HASH_NFKC)
    assert verify_password("Ｐａｓｓｗｏｒｄ１", NODE_HASH_NFKC)


# --- session tokens -------------------------------------------------------------

def test_new_session_token():
    tokens = {new_session_token() for _ in range(20)}
    assert len(tokens) == 20
    assert all(len(t) == 32 and "." not in t for t in tokens)


def test_sign_unsign_round_trip():
    token = new_session_token()
    signed = sign_token(token)
    assert signed.startswith(token + ".")
    assert unsign_token(signed) == token


def test_tampered_signature_rejected():
    token = new_session_token()
    signed = sign_token(token)
    flipped = signed[:-2] + ("A" if signed[-2] != "A" else "B") + signed[-1]
    assert unsign_token(flipped) is None
    assert unsign_token(signed + "x") is None
    assert unsign_token(token + ".") is None


def test_signature_does_not_transfer_to_another_token():
    sig = sign_token("token-one").rpartition(".")[2]
    assert unsign_token(f"token-two.{sig}") is None


def test_url_encoded_signed_token_accepted():
    token = new_session_token()
    assert unsign_token(quote(sign_token(token), safe="")) == token


def test_unpadded_signature_accepted():
    token = new_session_token()
    assert unsign_token(sign_token(token).rstrip("=")) == token


def test_bare_token_accepted():
    assert unsign_token("  rawtoken123  ") == "rawtoken123"
    assert unsign_token("") is None


def test_accepts_better_call_signed_cookie(conftest_secret):
    assert sign_token(NODE_TOKEN) == NODE_COOKIE.replace("%2B", "+").replace("%2F", "/").replace("%3D", "=")
    assert unsign_token(NODE_COOKIE) == NODE_TOKEN


def test_better_call_cookie_rejected_under_other_secret(conftest_secret, monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_secret", "a-completely-different-secret-value")
    assert unsign_token(NODE_COOKIE) is None


# --- verify-email JWT -----------------------------------------------------------

def test_verify_email_round_trip_lowercases():
    token = create_verify_email_token("Sara@Example.COM")
    assert read_verify_email_token(token) == "sara@example.com"
    claims = jwt.decode(token, get_settings().auth_secret, algorithms=["HS256"])
    assert claims["exp"] - claims["iat"] == 3600


def test_verify_email_expired(monkeypatch):
    monkeypatch.setattr(security, "VERIFY_EMAIL_TTL", timedelta(seconds=-5))
    assert read_verify_email_token(create_verify_email_token("a@b.co")) is None


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        jwt.encode({"email": "a@b.co"}, "wrong-secret-wrong-secret-wrong-secret", algorithm="HS256"),
    ],
)
def test_verify_email_invalid(token):
    assert read_verify_email_token(token) is None


def test_verify_email_requires_string_email():
    token = jwt.encode({"email": 123}, get_settings().auth_secret, algorithm="HS256")
    assert read_verify_email_token(token) is None
