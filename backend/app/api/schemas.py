"""Request/response models. Python stays snake_case; the wire format stays the
camelCase the dashboard already consumes (alias_generator=to_camel)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class RequestModel(CamelModel):
    # Dashboard forms sometimes post whole objects back; ignore unknown keys.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


# ─── Chatbots ─────────────────────────────────────────────────────────────────


class CategoryOut(CamelModel):
    id: str
    chatbot_id: str
    name: str
    pages: int
    enabled: bool
    indexed: bool


class ChatbotOut(CamelModel):
    id: str
    name: str
    url: str
    embed_token: str
    status: str
    is_trained: bool
    last_trained_at: datetime | None
    system_prompt: str | None
    personality_type: str | None
    welcome_message: str | None
    theme_color: str | None
    user_id: str
    widget_theme: str
    widget_width: int
    widget_height: int
    logo_url: str | None
    primary_color: str | None
    header_color: str | None
    bot_avatar: str | None
    input_placeholder: str | None
    show_powered_by: bool
    lead_config: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
    categories: list[CategoryOut] = []


WidgetThemeIn = Literal["light", "dark", "auto"]


class ChatbotCreate(RequestModel):
    url: str
    name: str | None = None
    system_prompt: str | None = None
    personality_type: str | None = None
    welcome_message: str | None = None
    theme_color: str | None = None
    primary_color: str | None = None
    widget_theme: WidgetThemeIn | None = None
    widget_width: int | None = None
    widget_height: int | None = None
    show_powered_by: bool | None = None
    input_placeholder: str | None = None


class ChatbotUpdate(RequestModel):
    name: str | None = None
    status: Literal["ACTIVE", "TRAINING", "INACTIVE"] | None = None
    system_prompt: str | None = None
    personality_type: str | None = None
    welcome_message: str | None = None
    theme_color: str | None = None
    primary_color: str | None = None
    widget_theme: WidgetThemeIn | None = None
    widget_width: int | None = None
    widget_height: int | None = None
    logo_url: str | None = None
    header_color: str | None = None
    bot_avatar: str | None = None
    input_placeholder: str | None = None
    show_powered_by: bool | None = None
    lead_config: dict[str, Any] | None = None


class CategoryIn(RequestModel):
    name: str
    pages: int = 0
    enabled: bool = False
    indexed: bool = False


class CategoriesIn(RequestModel):
    categories: list[CategoryIn]
    is_trained: bool | None = None
    last_trained_at: datetime | None = None


class PublicChatbotOut(CamelModel):
    id: str
    name: str
    welcome_message: str | None
    theme_color: str | None
    primary_color: str | None
    is_trained: bool
    status: str
    embed_token: str
    widget_theme: str
    widget_width: int
    widget_height: int
    logo_url: str | None
    header_color: str | None
    bot_avatar: str | None
    input_placeholder: str | None
    show_powered_by: bool
    lead_config: dict[str, Any]


# ─── Chat ─────────────────────────────────────────────────────────────────────


class ChatTurn(BaseModel):
    question: str = ""
    answer: str = ""


class ChatRequest(BaseModel):
    question: str = ""
    token: str | None = None
    url: str | None = None
    sessionId: str | None = None  # noqa: N815 — wire names
    visitorId: str | None = None  # noqa: N815
    hostPageUrl: str | None = None  # noqa: N815
    history: list[ChatTurn] = Field(default_factory=list)


class ChatMessageOut(CamelModel):
    id: str
    session_id: str
    namespace: str
    question: str
    answer: str
    created_at: datetime


class SessionOut(CamelModel):
    id: str
    session_id: str
    visitor_id: str
    first_question: str | None
    message_count: int
    status: str
    started_at: datetime
    last_activity_at: datetime
    host_page_url: str | None


# ─── Leads ────────────────────────────────────────────────────────────────────


class LeadOut(CamelModel):
    id: str
    chatbot_id: str
    namespace: str
    session_id: str | None
    visitor_id: str | None
    name: str | None
    email: str | None
    phone: str | None
    company: str | None
    message: str | None
    fields: dict[str, Any] | None
    source: str | None
    status: str
    priority: str
    synced_at: datetime | None
    created_at: datetime


class LeadCreate(BaseModel):
    token: str | None = None
    sessionId: str | None = None  # noqa: N815
    visitorId: str | None = None  # noqa: N815
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    message: str | None = None
    hostPageUrl: str | None = None  # noqa: N815
    fields: dict[str, Any] | None = None


class LeadStatusIn(BaseModel):
    status: Literal["NEW", "CONTACTED", "ARCHIVED"]


class TestForwardIn(BaseModel):
    destination: Literal["email", "webhook", "sheet", "slack", "discord", "telegram"]
    url: str | None = None


# ─── Users ────────────────────────────────────────────────────────────────────


class UserBrief(CamelModel):
    id: str
    email: str
    name: str | None
    plan: str
    message_usage: int
    message_limit: int


class AdminUserOut(UserBrief):
    created_at: datetime
    chatbot_count: int


class NameIn(BaseModel):
    name: str | None = None


class PlanIn(BaseModel):
    plan: str
