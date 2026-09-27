"""app.lib.contact_extract — spec: dl-chat-rag/backend/src/lib/contact-extract.ts."""

import pytest

from app.lib.contact_extract import ExtractedContact, extract_contact, has_contact_handle


def test_empty_message():
    assert extract_contact("") == ExtractedContact()
    assert not has_contact_handle("")


# --- names -----------------------------------------------------------------

@pytest.mark.parametrize(
    "text",
    [
        "I'm interested in the AI service",  # regression: used to become "In The"
        "I am looking for a chatbot for my store",
        "this is exactly what we need",
        "Hi there, I'm from Lahore",
    ],
)
def test_bare_im_is_not_a_name(text):
    assert extract_contact(text).name is None


@pytest.mark.parametrize(
    ("text", "name"),
    [
        ("my name is Sara and I want a website", "Sara"),  # stops at "and"
        ("Hey, my name is sara khan", "Sara Khan"),  # capitalised
        ("My name's Ali, thanks", "Ali"),
        ("you can call me Umair", "Umair"),
        ("I'm called John Smith Doe Jr", "John Smith Doe"),  # at most 3 words
        ("Name: Fatima Noor", "Fatima Noor"),
        ("name - Bilal", "Bilal"),
    ],
)
def test_explicit_name_declarations(text, name):
    assert extract_contact(text).name == name


def test_name_trigger_followed_by_stopword_yields_nothing():
    assert extract_contact("call me at your convenience").name is None
    assert extract_contact("my name is not important").name is None


# --- email / phone -----------------------------------------------------------

def test_email():
    c = extract_contact("reach me at Sara.Khan+bot@Example.co.uk please")
    assert c.email == "Sara.Khan+bot@Example.co.uk"


@pytest.mark.parametrize(
    ("text", "phone"),
    [
        ("my number is 0300-1234567", "0300-1234567"),
        ("call +92 300 1234567 anytime", "+92 300 1234567"),
        ("US office: 415.555.0132", "415.555.0132"),
    ],
)
def test_phone_numbers(text, phone):
    assert extract_contact(text).phone == phone
    assert has_contact_handle(text)


@pytest.mark.parametrize(
    "text",
    [
        "We started in 2024.",
        "Is it $500 or $1,200 per month?",
        "Order #12345 is late",
        "The plan is 29.99",
    ],
)
def test_years_and_prices_are_not_phones(text):
    assert extract_contact(text).phone is None
    assert not has_contact_handle(text)


def test_too_many_digits_rejected():
    assert extract_contact("ref 1234567890123456789").phone is None


def test_contact_handle_by_email_only():
    assert has_contact_handle("sara@example.com")
    assert not has_contact_handle("my name is Sara")


# --- company -----------------------------------------------------------------

@pytest.mark.parametrize(
    ("text", "company"),
    [
        ("I work at Acme Corp.", "Acme Corp"),
        ("I work for Globex", "Globex"),
        ("my company is Initech", "Initech"),
        ("Company: Stark Industries", "Stark Industries"),
    ],
)
def test_company(text, company):
    assert extract_contact(text).company == company


@pytest.mark.parametrize(
    "text",
    [
        "I work at home most days",
        "I work at night",
        "I work for the government",
        "I work for my dad",
        "I work at the moment on weekends",
    ],
)
def test_company_blocklist(text):
    assert extract_contact(text).company is None


def test_full_message():
    c = extract_contact("Hi, my name is Sara, email sara@acme.io, phone 0300-1234567, I work at Acme")
    assert c == ExtractedContact(name="Sara", email="sara@acme.io", phone="0300-1234567", company="Acme")


def test_company_equal_to_name_is_not_captured():
    c = extract_contact("name: Acme, company: Acme")
    assert c.name == "Acme"
    assert c.company is None


# ─── Edge cases fixed in the Python port (were wrong in the TypeScript) ───────


def test_name_stops_at_sentence_end():
    assert extract_contact("my name is Sara. Email sara@x.io").name == "Sara"


def test_company_stops_at_clause_break():
    assert extract_contact("I work for Acme Corp, and I need a bot").company == "Acme Corp"


def test_phone_keeps_leading_parenthesis():
    assert extract_contact("call (415) 555-0132 please").phone == "(415) 555-0132"
