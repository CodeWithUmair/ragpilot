"""app.rag.prompts — guardrail text assertions (cheap regression net for
prompt wording that graph tests can't check without a real LLM)."""

from app.lib.contact_extract import ExtractedContact
from app.rag.prompts import build_system_prompt


def test_checkout_link_guardrail_present():
    """Phase 3b of docs/AGENT_VISION.md: the model already sees Source URLs in
    Context (retrieval.build_context), so pointing at them is a prompt rule,
    not new plumbing — this guards against that rule being dropped."""
    prompt = build_system_prompt(
        persona=None, business_name="Acme", lead_enabled=False,
        contact=ExtractedContact(), context="[Pricing]\nOur plan costs $10.\nSource: https://acme.io/pricing",
    )
    assert "give them that exact link" in prompt
