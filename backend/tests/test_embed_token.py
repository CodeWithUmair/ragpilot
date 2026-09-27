"""app.lib.embed_token — spec: dl-chat-rag/backend/src/lib/chatbot-token.ts."""

import pytest

from app.lib.embed_token import generate_embed_token, is_embed_token


def test_generated_tokens_are_valid_and_random():
    tokens = {generate_embed_token() for _ in range(50)}
    assert len(tokens) == 50
    for t in tokens:
        assert len(t) == 32
        assert is_embed_token(t)


@pytest.mark.parametrize(
    ("value", "ok"),
    [
        ("0123456789abcdef0123456789abcdef", True),
        ("0123456789ABCDEF0123456789ABCDEF", True),  # case-insensitive
        ("  0123456789abcdef0123456789abcdef \n", True),  # trimmed
        ("0123456789abcdef0123456789abcde", False),  # 31
        ("0123456789abcdef0123456789abcdef0", False),  # 33
        ("0123456789abcdef0123456789abcdeg", False),  # non-hex
        ("", False),
        (None, False),
    ],
)
def test_is_embed_token(value, ok):
    assert is_embed_token(value) is ok
