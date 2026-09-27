"""app.lib.lead_config — spec: dl-chat-rag/backend/src/lib/lead-config.ts."""

import pytest

from app.lib.lead_config import DEFAULT_LEAD_CONFIG, detect_lead_intent, public_lead_config, resolve_lead_config


@pytest.mark.parametrize("raw", [None, "junk", 42, [], [{"enabled": True}]])
def test_non_object_resolves_to_defaults(raw):
    assert resolve_lead_config(raw) == DEFAULT_LEAD_CONFIG


def test_empty_object_resolves_to_defaults():
    assert resolve_lead_config({}) == DEFAULT_LEAD_CONFIG


def test_resolve_does_not_hand_out_the_shared_default():
    c = resolve_lead_config(None)
    c["enabled"] = True
    assert DEFAULT_LEAD_CONFIG["enabled"] is False


def test_partial_config_is_filled_and_cleaned():
    c = resolve_lead_config(
        {
            "enabled": True,
            "fields": ["company", "email", "fax", 3],
            "required": ["nope"],
            "trigger": "always",
            "heading": "  Talk to us  ",
            "successMessage": "   ",
            "notifyEmail": None,
            "webhookUrl": "  https://hooks.example.com/x  ",
            "sheetUrl": 123,
        }
    )
    assert c == {
        "enabled": True,
        "fields": ["company", "email"],  # unknown fields dropped, order kept
        "required": ["email"],  # nothing valid -> default
        "trigger": "intent",  # only supported trigger
        "heading": "Talk to us",
        "successMessage": DEFAULT_LEAD_CONFIG["successMessage"],  # blank -> default
        "notifyEmail": True,  # only an explicit False turns it off
        "webhookUrl": "https://hooks.example.com/x",
        "sheetUrl": "",
    }


@pytest.mark.parametrize(("value", "expected"), [(True, True), ("yes", False), (1, False), (None, False)])
def test_enabled_requires_literal_true(value, expected):
    assert resolve_lead_config({"enabled": value})["enabled"] is expected


def test_notify_email_false_is_respected():
    assert resolve_lead_config({"notifyEmail": False})["notifyEmail"] is False


def test_public_subset_hides_forwarding_destinations():
    raw = {
        "enabled": True,
        "webhookUrl": "https://hooks.example.com/secret",
        "sheetUrl": "https://script.google.com/macros/s/abc/exec",
        "notifyEmail": False,
    }
    pub = public_lead_config(raw)
    assert set(pub) == {"enabled", "fields", "required", "heading", "successMessage"}
    assert "secret" not in repr(pub)
    assert pub["enabled"] is True


@pytest.mark.parametrize(
    "text",
    [
        "What's your pricing?",
        "how much does a chatbot cost",
        "Can I book a demo?",
        "I'd like to talk to someone",
        "I'm interested in the AI service",
        "Can you build me a website?",
        "I want to hire a developer",
        "how do I sign up",
        "please email me the details",
    ],
)
def test_intent_detected(text):
    assert detect_lead_intent(text)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "sara@example.com",  # handing over details is capture, not intent
        "0300-1234567",
        "my name is Sara, sara@example.com",
        "What does your company do?",
        "Tell me about your team",
        "reorder the list",  # \b guards: "order" inside a word
    ],
)
def test_no_intent(text):
    assert not detect_lead_intent(text)
