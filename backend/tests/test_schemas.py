"""app.api.schemas — trust-boundary length caps on public, unauthenticated
endpoints (2026-09-29): these fields had no limit at all before."""

import pytest
from pydantic import ValidationError

from app.api.schemas import LEAD_FIELDS_MAX_BYTES, QUESTION_MAX, ChatRequest, LeadCreate


def test_chat_question_over_the_cap_is_rejected():
    with pytest.raises(ValidationError):
        ChatRequest(question="x" * (QUESTION_MAX + 1))


def test_chat_question_at_the_cap_is_fine():
    ChatRequest(question="x" * QUESTION_MAX)


def test_chat_history_list_is_capped():
    with pytest.raises(ValidationError):
        ChatRequest(history=[{"question": "q", "answer": "a"}] * 21)


def test_lead_name_over_the_cap_is_rejected():
    with pytest.raises(ValidationError):
        LeadCreate(email="a@b.com", name="x" * 201)


def test_lead_fields_dict_over_the_byte_cap_is_rejected():
    with pytest.raises(ValidationError):
        LeadCreate(email="a@b.com", fields={"note": "x" * (LEAD_FIELDS_MAX_BYTES + 1)})


def test_lead_fields_dict_within_the_cap_is_fine():
    LeadCreate(email="a@b.com", fields={"note": "a normal note"})
