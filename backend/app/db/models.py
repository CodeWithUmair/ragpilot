"""SQLAlchemy 2.0 models.

Table + column names deliberately match the original Prisma schema (quoted
camelCase: "Chatbot"."embedToken"), so this backend can run against the
existing production database with no data migration. Python attributes are
snake_case; the API layer converts back to camelCase via Pydantic aliases.
"""

import secrets
import string
import uuid
from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String, Text, TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

EMBED_DIMENSIONS = 1024

_ID_ALPHABET = string.ascii_letters + string.digits


def auth_id() -> str:
    """32-char alphanumeric id — the format Better Auth used for users/sessions."""
    return "".join(secrets.choice(_ID_ALPHABET) for _ in range(32))


def uuid_str() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    """Prisma stores `timestamp(3) without time zone` holding UTC. Attach UTC on
    read so the API emits `...+00:00` — a naive ISO string would be parsed as
    LOCAL time by `new Date()` in the browser and shift every timestamp."""

    impl = TIMESTAMP(precision=3)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(UTC).replace(tzinfo=None)
        return value

    def process_result_value(self, value: datetime | None, dialect):
        return value.replace(tzinfo=UTC) if value is not None else None


def _enum(*values: str, name: str) -> Enum:
    # create_type=False: the Postgres enum types are created by the migration.
    return Enum(*values, name=name, create_type=False)


ChatbotStatus = _enum("ACTIVE", "TRAINING", "INACTIVE", name="ChatbotStatus")
WidgetTheme = _enum("light", "dark", "auto", name="WidgetTheme")
SessionStatus = _enum("ACTIVE", "CLOSED", name="SessionStatus")
LeadStatus = _enum("NEW", "CONTACTED", "ARCHIVED", name="LeadStatus")


class Base(DeclarativeBase):
    pass


def created_col() -> Mapped[datetime]:
    return mapped_column("createdAt", UTCDateTime, default=utcnow, nullable=False)


def updated_col() -> Mapped[datetime]:
    return mapped_column("updatedAt", UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)


class User(Base):
    __tablename__ = "User"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=auth_id)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, unique=True)
    email_verified: Mapped[bool] = mapped_column("emailVerified", Boolean, default=False)
    image: Mapped[str | None] = mapped_column(String)
    plan: Mapped[str] = mapped_column(String, default="free")
    message_usage: Mapped[int] = mapped_column("messageUsage", Integer, default=0)
    message_limit: Mapped[int] = mapped_column("messageLimit", Integer, default=100)
    onboarding_completed: Mapped[bool] = mapped_column("onboardingCompleted", Boolean, default=False)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()

    chatbots: Mapped[list["Chatbot"]] = relationship(back_populates="user", passive_deletes=True)


class Session(Base):
    __tablename__ = "Session"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=auth_id)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", UTCDateTime)
    token: Mapped[str] = mapped_column(String, unique=True)
    ip_address: Mapped[str | None] = mapped_column("ipAddress", String)
    user_agent: Mapped[str | None] = mapped_column("userAgent", String)
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class Account(Base):
    __tablename__ = "Account"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=auth_id)
    account_id: Mapped[str] = mapped_column("accountId", String)
    provider_id: Mapped[str] = mapped_column("providerId", String)
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    access_token: Mapped[str | None] = mapped_column("accessToken", String)
    refresh_token: Mapped[str | None] = mapped_column("refreshToken", String)
    id_token: Mapped[str | None] = mapped_column("idToken", Text)
    access_token_expires_at: Mapped[datetime | None] = mapped_column("accessTokenExpiresAt", UTCDateTime)
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column("refreshTokenExpiresAt", UTCDateTime)
    scope: Mapped[str | None] = mapped_column(String)
    password: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class Chatbot(Base):
    __tablename__ = "Chatbot"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String)
    url: Mapped[str] = mapped_column(String)
    embed_token: Mapped[str] = mapped_column("embedToken", String, unique=True)
    status: Mapped[str] = mapped_column(ChatbotStatus, default="ACTIVE")
    is_trained: Mapped[bool] = mapped_column("isTrained", Boolean, default=False)
    last_trained_at: Mapped[datetime | None] = mapped_column("lastTrainedAt", UTCDateTime)
    system_prompt: Mapped[str | None] = mapped_column("systemPrompt", String)
    personality_type: Mapped[str | None] = mapped_column("personalityType", String, default="general")
    welcome_message: Mapped[str | None] = mapped_column("welcomeMessage", String)
    theme_color: Mapped[str | None] = mapped_column("themeColor", String)
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))

    widget_theme: Mapped[str] = mapped_column("widgetTheme", WidgetTheme, default="auto")
    widget_width: Mapped[int] = mapped_column("widgetWidth", Integer, default=380)
    widget_height: Mapped[int] = mapped_column("widgetHeight", Integer, default=580)
    logo_url: Mapped[str | None] = mapped_column("logoUrl", String)
    primary_color: Mapped[str | None] = mapped_column("primaryColor", String, default="#6B46C1")
    header_color: Mapped[str | None] = mapped_column("headerColor", String)
    bot_avatar: Mapped[str | None] = mapped_column("botAvatar", String)
    input_placeholder: Mapped[str | None] = mapped_column("inputPlaceholder", String, default="Ask a question...")
    show_powered_by: Mapped[bool] = mapped_column("showPoweredBy", Boolean, default=True)
    lead_config: Mapped[dict[str, Any] | None] = mapped_column("leadConfig", JSONB)

    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()

    user: Mapped[User] = relationship(back_populates="chatbots")
    categories: Mapped[list["ChatbotCategory"]] = relationship(
        back_populates="chatbot", lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )


class ChatbotCategory(Base):
    __tablename__ = "ChatbotCategory"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    chatbot_id: Mapped[str] = mapped_column("chatbotId", ForeignKey("Chatbot.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String)
    pages: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    indexed: Mapped[bool] = mapped_column(Boolean, default=False)

    chatbot: Mapped[Chatbot] = relationship(back_populates="categories")


class ChatSession(Base):
    __tablename__ = "ChatSession"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column("sessionId", String, unique=True)
    namespace: Mapped[str] = mapped_column(String)
    chatbot_id: Mapped[str | None] = mapped_column("chatbotId", ForeignKey("Chatbot.id", ondelete="SET NULL"))
    chatbot_url: Mapped[str | None] = mapped_column("chatbotUrl", String)
    chatbot_token: Mapped[str | None] = mapped_column("chatbotToken", String)
    host_page_url: Mapped[str | None] = mapped_column("hostPageUrl", String)
    ip_address: Mapped[str | None] = mapped_column("ipAddress", String)
    visitor_id: Mapped[str] = mapped_column("visitorId", String)
    started_at: Mapped[datetime] = mapped_column("startedAt", UTCDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column("endedAt", UTCDateTime)
    last_activity_at: Mapped[datetime] = mapped_column("lastActivityAt", UTCDateTime, default=utcnow)
    last_user_message_at: Mapped[datetime] = mapped_column("lastUserMessageAt", UTCDateTime, default=utcnow)
    message_count: Mapped[int] = mapped_column("messageCount", Integer, default=0)
    status: Mapped[str] = mapped_column(SessionStatus, default="ACTIVE")
    first_question: Mapped[str | None] = mapped_column("firstQuestion", String)


class ChatMessage(Base):
    __tablename__ = "ChatMessage"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(
        "sessionId", ForeignKey("ChatSession.sessionId", ondelete="CASCADE")
    )
    namespace: Mapped[str] = mapped_column(String)
    question: Mapped[str] = mapped_column(String)
    answer: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = created_col()


class Lead(Base):
    __tablename__ = "Lead"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    chatbot_id: Mapped[str] = mapped_column("chatbotId", ForeignKey("Chatbot.id", ondelete="CASCADE"))
    namespace: Mapped[str] = mapped_column(String)
    session_id: Mapped[str | None] = mapped_column("sessionId", String)
    visitor_id: Mapped[str | None] = mapped_column("visitorId", String)
    name: Mapped[str | None] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String)
    company: Mapped[str | None] = mapped_column(String)
    message: Mapped[str | None] = mapped_column(Text)
    fields: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    source: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(LeadStatus, default="NEW")
    synced_at: Mapped[datetime | None] = mapped_column("syncedAt", UTCDateTime)
    created_at: Mapped[datetime] = created_col()


class KnowledgeVector(Base):
    """One embedded chunk. Reads/writes of `embedding` go through raw SQL in
    app/rag/vector_store.py; the ORM mapping exists for counts and deletes."""

    __tablename__ = "KnowledgeVector"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    namespace: Mapped[str] = mapped_column(String)
    content_hash: Mapped[str] = mapped_column("contentHash", String)
    type: Mapped[str] = mapped_column(String)
    section_type: Mapped[str | None] = mapped_column("sectionType", String)
    heading_path: Mapped[str | None] = mapped_column("headingPath", String)
    source: Mapped[str | None] = mapped_column(String)
    title: Mapped[str | None] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIMENSIONS), deferred=True)
    created_at: Mapped[datetime] = created_col()
