"""System prompt assembly. The chatbot's own systemPrompt sets the persona;
the grounding guardrails are always appended, so a custom persona can never
switch off the anti-hallucination rules."""

from app.lib.contact_extract import ExtractedContact
from app.rag.providers import Message

DEFAULT_PERSONA = (
    "You are a friendly, helpful assistant for this business. You answer visitor questions clearly "
    "and concisely and help them take the next step (such as contacting the team)."
)

_LEAD_NUDGE = (
    "\n- When a visitor shows interest, first ask one or two brief, friendly qualifying questions to "
    "understand what they actually want (their goal, use case, or scope). Only once you understand their "
    "need should you warmly invite them to leave their contact details so the team can follow up — never "
    "ask for contact details in your very first reply."
)

_NO_CONTEXT = (
    "No relevant context was found for this question. Tell the user you don't have that information yet "
    "and offer to help with something else or connect them with the team — do NOT answer from general knowledge."
)

_SMALLTALK = (
    "The visitor sent a greeting or a short social message, not a question. Reply warmly in one or two "
    "sentences and ask how you can help. Do not state any facts about the business."
)


def _guardrails(business_name: str | None, lead_enabled: bool) -> str:
    about = f" about {business_name}" if business_name else ""
    return (
        f"Ground every answer in the Context below — it is your only source of truth{about}. "
        "Follow these rules strictly:\n"
        "- Use ONLY facts found in the Context. Do not use outside or general knowledge, and never invent "
        "details, prices, timelines, features, or promises.\n"
        "- When a visitor asks whether you offer a specific product or service, judge it in three steps: "
        "(1) DIRECT match — the Context describes the exact thing they asked for: describe it. (2) NO direct "
        "match: clearly tell them you don't offer that specific thing. (3) Only after saying that, suggest an "
        "alternative ONLY if it genuinely serves the SAME need. An item that merely shares a keyword is NOT a "
        'real match — e.g. an "Ethereum Unit Converter" or any crypto/blockchain tool is NOT a "basic math '
        'calculator"; a "smart contract audit" is NOT "web design". If nothing in the Context genuinely fits '
        "their need, do NOT list unrelated offerings to fill the gap — instead say you don't have that and "
        "offer to pass their request to the team or ask what they're trying to achieve. Never re-suggest "
        "something the visitor has already turned down earlier in the conversation.\n"
        "- If the visitor wants to buy, order, book, or sign up for something specific and a Context chunk for "
        "it has a Source URL, give them that exact link as the next step (e.g. \"You can order that here: "
        "<url>\") instead of only describing it — the link IS the action, don't just talk about the item.\n"
        "- If the Context does not contain the answer, say you don't have that specific information instead "
        "of guessing. Then offer to help with related things you do know, or invite the user to contact the "
        "team using any contact details that appear in the Context.\n"
        "- For questions about feasibility, pricing, timelines, or custom work that the Context does not "
        "explicitly cover, do not commit to numbers or promises — acknowledge the request and invite the user "
        "to share their requirements or reach out to the team.\n"
        "- Detect the user's language from their message and reply in that same language. Be concise and "
        f"natural.{_LEAD_NUDGE if lead_enabled else ''}"
    )


def _memory_block(contact: ExtractedContact) -> str:
    lines = [
        f"{label}: {value}"
        for label, value in (
            ("name", contact.name), ("email", contact.email),
            ("phone", contact.phone), ("company", contact.company),
        )
        if value
    ]
    if not lines:
        return ""
    return (
        "\n\nWhat you already know about this visitor (remember and use this — address them by their first "
        "name when it feels natural, and do NOT ask again for details listed here):\n- " + "\n- ".join(lines)
    )


def build_system_prompt(
    *,
    persona: str | None,
    business_name: str | None,
    lead_enabled: bool,
    contact: ExtractedContact,
    context: str,
    smalltalk: bool = False,
) -> str:
    head = (persona or "").strip() or DEFAULT_PERSONA
    body = _SMALLTALK if smalltalk else f"Context:\n{context or _NO_CONTEXT}"
    return f"{head}\n\n{_guardrails(business_name, lead_enabled)}{_memory_block(contact)}\n\n{body}"


def history_messages(history: list[dict], max_turns: int = 6) -> list[Message]:
    out: list[Message] = []
    for turn in history[-max_turns:]:
        out.append({"role": "user", "content": str(turn.get("question", ""))})
        out.append({"role": "assistant", "content": str(turn.get("answer", ""))})
    return out


REWRITE_SYSTEM = (
    "You rewrite a visitor's follow-up message into ONE standalone search query for a website's knowledge "
    "base. Resolve pronouns and references (\"it\", \"that\", \"the second one\", \"how much?\") using the "
    "conversation. Keep the visitor's intent; do not answer the question. Output only the query, no quotes."
)
