"""app.services.leads — pure formatting logic (Phase 3a of docs/AGENT_VISION.md:
Slack/Discord/Telegram get a short text summary, not the raw lead JSON the
webhook/sheet destinations get)."""

from app.services.leads import _lead_text


def test_lead_text_includes_present_fields_only():
    text = _lead_text(
        {"priority": "HOT", "name": "Sara", "email": "sara@acme.io", "phone": "", "company": "", "message": ""},
        "Acme Bot",
    )
    assert text == "New lead from Acme Bot\nPriority: HOT\nName: Sara\nEmail: sara@acme.io"


def test_lead_text_with_nothing_but_the_header():
    assert _lead_text({}, "Acme Bot") == "New lead from Acme Bot"
