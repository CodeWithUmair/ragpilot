"""app.lib.text_clean — spec: dl-chat-rag/backend/src/lib/text-clean.ts."""

import pytest

from app.lib.text_clean import collapse_ws, dedupe_content, is_boilerplate, normalize_for_dedup

REAL = "The Pro plan costs $29 per month and includes three chatbots."


@pytest.mark.parametrize(
    "text",
    [
        "Read more",  # too short to carry an answer
        "   Home \n  About   Contact  ",
        "© 2025 Acme Inc. Built with love in Karachi, Pakistan.",
        "Copyright (c) 2024 Acme Inc, a company that sells widgets.",
        "Acme Inc. All Rights Reserved. Made with care since 1999.",
        "Privacy Policy | Terms of Service | Sitemap | Careers here",
        "Oops! Page not found. Try heading back to the homepage.",
        "404 - requested resource not found on this server, sorry",
        "Sorry, the page you're looking for has gone somewhere else.",
        "Sorry, the page requested cannot be found on this server.",
        "This article doesn't exist or has been moved to a new place.",
        "We use cookies to improve your experience on our website.",
        "Please enable JavaScript to view this website properly, thanks.",
    ],
)
def test_boilerplate_detected(text):
    assert is_boilerplate(text)


@pytest.mark.parametrize(
    "text",
    [
        REAL,
        "We build custom AI chatbots trained on your own website content.",
        "Our privacy-first approach means data never leaves your region.",  # no "privacy policy | terms"
        "Founded in 2019, we have shipped over 200 projects worldwide.",  # a year, but no ©
    ],
)
def test_real_content_kept(text):
    assert not is_boilerplate(text)


def test_short_threshold_uses_collapsed_whitespace():
    # 24 visible chars padded with lots of whitespace is still "too short".
    assert is_boilerplate("abcdefghij   \n\n   klmnopqrstuv")
    assert not is_boilerplate("a" * 25)


def test_collapse_ws():
    assert collapse_ws("  a \n\t b  ") == "a b"


def test_normalize_for_dedup_strips_labels_punctuation_case():
    a = normalize_for_dedup("[Home > About]\nOur Team, builds AI!")
    b = normalize_for_dedup("[Services]  our team builds   ai")
    assert a == b == "our team builds ai"


def test_normalize_for_dedup_empty_for_pure_punctuation():
    assert normalize_for_dedup("[label] ---  !!!") == ""


def test_dedupe_content_keeps_first_copy_and_drops_boilerplate():
    items = [
        {"id": 1, "text": REAL},
        {"id": 2, "text": "© 2025 Acme Inc. Built with love in Karachi."},
        {"id": 3, "text": "[Pricing] " + REAL.upper()},  # same text, different label/case
        {"id": 4, "text": "We build custom AI chatbots trained on your site."},
        {"id": 5, "text": "Home"},
    ]
    out = dedupe_content(items, lambda i: i["text"])
    assert [i["id"] for i in out] == [1, 4]


def test_dedupe_content_accepts_any_iterable():
    out = dedupe_content((t for t in [REAL, REAL]), lambda t: t)
    assert out == [REAL]
