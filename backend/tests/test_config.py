"""app.core.config — regression test for a real bug caught during the first
live OpenAI smoke test (2026-09-28): `OPENAI_BASE_URL=` in .env resolves to
an empty string, and AsyncOpenAI(base_url="") is NOT the same as base_url
unset — it produces a schemeless request URL and every call fails with
openai.APIConnectionError. .env.example documents "leave empty for OpenAI",
so the Settings layer must normalize "" to None itself."""

from app.core.config import Settings

_REQUIRED = {"database_url": "postgresql://x/db", "auth_secret": "s", "openai_api_key": "sk-x"}


def test_blank_openai_base_url_becomes_none():
    s = Settings(**_REQUIRED, openai_base_url="")  # type: ignore[call-arg]
    assert s.openai_base_url is None


def test_unset_openai_base_url_is_none():
    s = Settings(**_REQUIRED)  # type: ignore[call-arg]
    assert s.openai_base_url is None


def test_real_openai_base_url_override_is_kept():
    s = Settings(**_REQUIRED, openai_base_url="https://api.groq.com/openai/v1")  # type: ignore[call-arg]
    assert s.openai_base_url == "https://api.groq.com/openai/v1"
