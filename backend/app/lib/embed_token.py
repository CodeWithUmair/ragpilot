"""Per-chatbot embed tokens. The token doubles as the knowledge namespace, so a
random value (not hash-of-URL) keeps two users who register the same site in
separate, isolated namespaces."""

import re
import secrets

_TOKEN_RE = re.compile(r"^[a-f0-9]{32}$", re.I)


def generate_embed_token() -> str:
    return secrets.token_hex(16)


def is_embed_token(value: str | None) -> bool:
    return bool(value) and bool(_TOKEN_RE.match(value.strip()))
