"""Typed settings loaded from the environment (and `.env` in development).

pydantic-settings validates every variable at startup, so a missing
OPENAI_API_KEY or DATABASE_URL fails fast instead of on the first request —
the same job zod did in the Express version.
"""

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _email_set(raw: str | None) -> frozenset[str]:
    if not raw:
        return frozenset()
    return frozenset(e.strip().lower() for e in raw.split(",") if "@" in e)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    app_env: Literal["development", "production", "test"] = Field(
        "development", validation_alias=AliasChoices("APP_ENV", "NODE_ENV")
    )
    port: int = 4000
    database_url: str

    # Signs session tokens + email-verification JWTs. BETTER_AUTH_SECRET is
    # accepted so an existing deployment's secret (and its live sessions) keep working.
    auth_secret: str = Field(validation_alias=AliasChoices("AUTH_SECRET", "BETTER_AUTH_SECRET"))
    require_email_verification: bool = True
    google_client_id: str | None = None
    google_client_secret: str | None = None

    app_url: str = "http://localhost:3000"
    api_url: str = "http://localhost:4000"
    # Extra exact origins allowed to call the protected API (comma-separated).
    cors_extra_origins: str | None = None
    # Hostname suffixes allowed for the protected API (preview deploys etc.).
    cors_origin_suffixes: str = ".vercel.app,.umairamir.com"

    # ─── LLM stack ───────────────────────────────────────────────────────────
    # Any OpenAI-compatible endpoint works (OpenAI, Groq, Together, a local
    # vLLM/Ollama server) — set OPENAI_BASE_URL to switch providers.
    openai_api_key: str
    openai_base_url: str | None = None
    openai_embed_model: str = "text-embedding-3-small"
    # Must match the vector(1024) column. text-embedding-3-* is truncated to
    # this size via the `dimensions` request parameter.
    openai_embed_dimensions: int = 1024
    openai_chat_model: str = "gpt-4o-mini"

    # ─── Email (first configured transport wins: Resend → Gmail → SMTP → log) ─
    resend_api_key: str | None = None
    gmail_user: str | None = None
    gmail_app_password: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_pass: str | None = None
    email_from: str | None = None
    email_from_name: str = "RagPilot"

    admin_emails: str | None = Field(None, validation_alias=AliasChoices("ADMIN_EMAILS", "ADMIN_EMAIL"))
    test_pro_emails: str | None = None

    git_sha: str | None = None

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def admin_email_set(self) -> frozenset[str]:
        return _email_set(self.admin_emails)

    @property
    def test_pro_email_set(self) -> frozenset[str]:
        return _email_set(self.test_pro_emails)

    def is_admin_email(self, email: str | None) -> bool:
        return bool(email) and email.lower() in self.admin_email_set

    def is_test_pro_email(self, email: str | None) -> bool:
        return bool(email) and email.lower() in self.test_pro_email_set


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  (values come from the environment)
