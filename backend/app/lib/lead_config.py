"""Lead-capture config: defaults + a resolver for the nullable JSON column, so
the widget config endpoint, the chat agent and the forwarder all agree."""

import re
from typing import Any

ALL_FIELDS = ("name", "email", "phone", "company")

DEFAULT_LEAD_CONFIG: dict[str, Any] = {
    "enabled": False,
    "fields": ["name", "email", "phone"],
    "required": ["email"],
    "trigger": "intent",
    "heading": "Want our team to follow up? Leave your details:",
    "successMessage": "Thanks! Our team will get back to you shortly.",
    # Forwarding destinations — owner-only, never sent to the public widget.
    "notifyEmail": True,
    "webhookUrl": "",
    "sheetUrl": "",
}


def _fields(value: Any) -> list[str]:
    return [f for f in value if f in ALL_FIELDS] if isinstance(value, list) else []


def _text(value: Any, default: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else default


def resolve_lead_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return dict(DEFAULT_LEAD_CONFIG)
    return {
        "enabled": raw.get("enabled") is True,
        "fields": _fields(raw.get("fields")) or DEFAULT_LEAD_CONFIG["fields"],
        "required": _fields(raw.get("required")) or DEFAULT_LEAD_CONFIG["required"],
        "trigger": "intent",
        "heading": _text(raw.get("heading"), DEFAULT_LEAD_CONFIG["heading"]),
        "successMessage": _text(raw.get("successMessage"), DEFAULT_LEAD_CONFIG["successMessage"]),
        "notifyEmail": raw.get("notifyEmail") is not False,
        "webhookUrl": raw["webhookUrl"].strip() if isinstance(raw.get("webhookUrl"), str) else "",
        "sheetUrl": raw["sheetUrl"].strip() if isinstance(raw.get("sheetUrl"), str) else "",
    }


def public_lead_config(raw: Any) -> dict[str, Any]:
    """The subset that is safe to hand to the public widget."""
    c = resolve_lead_config(raw)
    return {k: c[k] for k in ("enabled", "fields", "required", "heading", "successMessage")}


# Buying / contact / engagement intent. Deliberately does NOT fire just because
# the message contains an email or phone: a visitor who handed over details
# should be captured, not shown a form asking for what they just typed.
_LEAD_INTENT_RE = re.compile(
    r"\b(pric(e|ing)|quote|cost|how much|budget|timeline|hire|buy|purchase|order|demo|trial|book|schedule"
    r"|consult|get started|getting started|sign ?up|onboard|contact|reach (out|you)|talk to|speak (to|with)"
    r"|email me|call me|interested|work with|build (me|us|my|our|a|an)"
    r"|i (want|need|would like) to (build|start|hire|get|buy|work))\b",
    re.I,
)


def detect_lead_intent(text: str) -> bool:
    return bool(text) and bool(_LEAD_INTENT_RE.search(text))
