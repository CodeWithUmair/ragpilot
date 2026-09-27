"""Deterministic extraction of contact details a visitor volunteers in chat
("hey, my name is Sara, my number is 0300-1234567").

Heuristic on purpose — no extra LLM round-trip on the hot path — and
conservative: a wrong auto-captured value is worse than asking. Bare "I'm X"
is NOT a name trigger: it used to turn "I'm interested in the AI service" into
the name "In The" ("Absolutely, In The!").
"""

import re
from dataclasses import dataclass

EMAIL_RE = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.I)
# Optional +, then 8+ digits possibly split by spaces/dashes/dots/parens, so
# years ("2024") and prices ("$500") don't register as phone numbers.
PHONE_RE = re.compile(r"(\+?\(?\d[\d\s().-]{7,}\d)")

_NAME_RES = [
    re.compile(
        r"\b(?:my name is|my name's|i am called|i'm called|call me|name's)\s+"
        # No "." and no newlines: "my name is Sara. Email …" must yield "Sara".
        r"([a-z][a-z'-]+(?:[ \t]+[a-z][a-z'-]+){0,2})",
        re.I,
    ),
    re.compile(r"\bname\s*[:\-]\s*([a-z][a-z'-]+(?:[ \t]+[a-z][a-z'-]+){0,2})", re.I),
]
_COMPANY_RES = [
    re.compile(r"\b(?:i work (?:at|for)|company(?:'s| is| name is| named)?)\s+([a-z0-9][\w&.,' -]{1,60})", re.I),
    re.compile(r"\bcompany\s*[:\-]\s*([^\n,.;]{2,60})", re.I),
]

_NAME_STOPWORDS = {
    "interested", "looking", "trying", "wondering", "hoping", "just", "here",
    "good", "fine", "okay", "ok", "sorry", "sure", "not", "really", "still",
    "from", "with", "about", "the", "a", "an", "in", "on", "at", "to", "for",
    "going", "planning", "thinking", "new", "ready", "curious", "confused",
    "having", "getting", "working", "building", "doing", "asking",
    "and", "but", "or", "so", "plus", "then", "i", "we", "my", "our",
}
_COMPANY_BLOCK = {
    "home", "night", "day", "work", "the", "a", "an", "it", "that", "this",
    "my", "our", "your", "here", "there", "now", "once", "first", "present",
    "moment", "time", "office",
}


@dataclass
class ExtractedContact:
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None


def _clean_name(raw: str) -> str | None:
    out: list[str] = []
    for word in raw.split():
        if len(word) <= 1 or word.lower() in _NAME_STOPWORDS:
            break
        out.append(word[0].upper() + word[1:])
        if len(out) == 3:
            break
    name = " ".join(out)
    return name if len(name) >= 2 else None


def _clean_company(raw: str) -> str | None:
    # A company name ends at the first clause break ("Acme Corp, and I need…").
    words = re.split(r"[,;]| and | but ", raw.strip(), maxsplit=1)[0].rstrip(". ").split()
    if not words or words[0].lower() in _COMPANY_BLOCK:
        return None
    company = " ".join(words[:4])
    return company[:80] if len(company) >= 2 else None


def _normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    return raw.strip() if 8 <= len(digits) <= 15 else None


def extract_contact(text: str) -> ExtractedContact:
    out = ExtractedContact()
    if not text:
        return out
    if m := EMAIL_RE.search(text):
        out.email = m.group(0).strip()
    if m := PHONE_RE.search(text):
        out.phone = _normalize_phone(m.group(1))
    for regex in _NAME_RES:
        if (m := regex.search(text)) and (name := _clean_name(m.group(1))):
            out.name = name
            break
    for regex in _COMPANY_RES:
        if (m := regex.search(text)) and (company := _clean_company(m.group(1))):
            if company.lower() != (out.name or "").lower():
                out.company = company
                break
    return out


def has_contact_handle(text: str) -> bool:
    """True if the message contains a usable email or phone number."""
    if not text:
        return False
    if EMAIL_RE.search(text):
        return True
    m = PHONE_RE.search(text)
    return bool(m and _normalize_phone(m.group(1)))
