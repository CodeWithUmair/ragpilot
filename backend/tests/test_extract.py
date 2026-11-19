"""app.ingest.extract — spec: dl-chat-rag/backend/src/controllers/scrape.controller.ts
(extractStructuredSections, splitText, looksLikeErrorPage, contentHash)."""

import pytest

from app.ingest.extract import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    Chunk,
    clean_chunks,
    content_hash,
    detect_page_type,
    looks_like_error_page,
    parse_html,
    split_text,
    url_category,
)

PAGE = """
<html lang="en">
<head>
  <title>  Acme   Pricing </title>
  <meta name="description" content="Plans and prices">
</head>
<body>
  <nav><ul class="menu"><li>Home page link text long enough to count</li></ul></nav>
  <header><div class="navbar">Header navigation text long enough to count</div></header>
  <div class="cookie-banner">We use cookies to make this site work nicely.</div>
  <main>
    <h1>Pricing</h1>
    <h2>Pro plan</h2>
    <p>The Pro plan costs 29 dollars per month and includes three chatbots.</p>
    <ul><li>Lead capture straight into Google Sheets for your team.</li></ul>
    <h2>How much does the Free plan cost?</h2>
    <p>The Free plan is free forever and includes one chatbot and 100 messages.</p>
    <p>A second paragraph under the question is a normal section, not an FAQ.</p>
    <table><tr><td>Messages per month on the Pro plan: 2,000</td></tr></table>
  </main>
  <footer><p>Copyright 2025 Acme Inc. Footer text long enough to count.</p></footer>
</body>
</html>
"""


@pytest.fixture(scope="module")
def page():
    return parse_html(PAGE)


def test_metadata(page):
    assert page.title == "Acme Pricing"
    assert page.description == "Plans and prices"
    assert page.lang == "en"


def test_metadata_defaults():
    p = parse_html("<p>just a fragment of text that is long enough to keep around</p>")
    assert (p.title, p.description, p.lang) == ("Untitled", "", "unknown")
    assert [c.section_type for c in p.chunks] == ["body"]


def test_chrome_is_stripped(page):
    for junk in ("Home page link", "Header navigation", "We use cookies", "Footer text"):
        assert junk not in page.text
        assert all(junk not in c.content for c in page.chunks)
    assert "Pro plan costs 29 dollars" in page.text


def test_heading_path_and_section_types(page):
    by_type = {}
    for c in page.chunks:
        by_type.setdefault(c.section_type, []).append(c)

    section = by_type["section"][0]
    assert section.heading_path == "Pricing > Pro plan"
    assert section.content == "Pricing > Pro plan\nThe Pro plan costs 29 dollars per month and includes three chatbots."

    li = by_type["list-item"][0]
    assert li.heading_path == "Pricing > Pro plan"
    assert li.content.endswith("Lead capture straight into Google Sheets for your team.")

    table = by_type["table"][0]
    assert table.heading_path == "Pricing > How much does the Free plan cost?"


def test_faq_pairing_from_question_heading(page):
    faqs = [c for c in page.chunks if c.section_type == "faq"]
    assert len(faqs) == 1  # only the FIRST paragraph under the question
    assert faqs[0].content == (
        "Question: How much does the Free plan cost?\n"
        "Answer: The Free plan is free forever and includes one chatbot and 100 messages."
    )
    follow_up = [c for c in page.chunks if "second paragraph" in c.content]
    assert follow_up[0].section_type == "section"


def test_heading_stack_pops_deeper_levels():
    html = """<body>
      <h1>Docs</h1><h2>Install</h2><h3>Windows</h3>
      <p>Run the installer and follow the prompts until it finishes.</p>
      <h2>Usage</h2>
      <p>Open the dashboard and create your first chatbot from a URL.</p>
    </body>"""
    paths = [c.heading_path for c in parse_html(html).chunks]
    assert paths == ["Docs > Install > Windows", "Docs > Usage"]


def test_skipped_heading_level_has_no_gap_in_path():
    html = "<body><h1>Top</h1><h3>Deep</h3><p>Paragraph text long enough to become a chunk here.</p></body>"
    assert parse_html(html).chunks[0].heading_path == "Top > Deep"


def test_short_blocks_ignored():
    html = "<body><h1>Title</h1><p>Too short.</p><p>This paragraph is definitely long enough to keep.</p></body>"
    assert [c.content for c in parse_html(html).chunks] == ["Title\nThis paragraph is definitely long enough to keep."]


# Real markup from decryptedlabs.io (classes/SVG paths trimmed). These facts were
# invisible to the bot: each piece is under MIN_BLOCK_CHARS or in a tag we don't walk.
STATS_PAGE = """<html><head><title>NFStay case study</title>
  <meta name="description" content="Tell us about your project. We respond in under 5 minutes."></head><body>
  <div><div><p>12+</p><div><svg><path d="M2 12h20"></path></svg><p>Countries Served</p></div></div>
       <div><span>$3M+</span><span>Raised By Clients</span></div></div>
  <dl><div><dd>120+</dd><dt>Tokenized properties</dt></div><div><dd>4.8/5</dd><dt>Average user rating</dt></div></dl>
  <dl><div><dt>Industry</dt><dd>PropTech / Real-World Assets / DeFi</dd></div>
      <div><dt>Region</dt><dd>United Kingdom</dd></div></dl>
  <dl><dt>Founded</dt><dd>2019</dd><dt>Team size</dt><dd>40 engineers</dd></dl>
  <div><span>Book a call</span><span>Read more</span></div>
</body></html>"""


def test_stat_and_definition_pairs_become_key_fact_chunks():
    facts = [c for c in parse_html(STATS_PAGE).chunks if c.section_type == "facts"]
    assert [c.content for c in facts] == [
        "[NFStay case study]\nKey facts: 12+ Countries Served; $3M+ Raised By Clients",
        "[NFStay case study]\nKey facts: 120+ Tokenized properties; 4.8/5 Average user rating",
        "[NFStay case study]\nKey facts: Industry: PropTech / Real-World Assets / DeFi; Region: United Kingdom",
        "[NFStay case study]\nKey facts: Founded: 2019; Team size: 40 engineers",
    ]
    assert all(c.heading_path == "NFStay case study" for c in facts)  # the model sees which page
    assert not any("Book a call" in c.content for c in facts)  # two CTA spans aren't a stat


def test_meta_description_is_indexed():
    chunks = parse_html(STATS_PAGE).chunks
    assert any(c.section_type == "description" and "under 5 minutes" in c.content for c in chunks)


def test_site_wide_stat_strip_dedupes_across_pages():
    other = STATS_PAGE.replace("NFStay case study", "About us")
    seen: set[str] = set()
    first = [c for c in clean_chunks(parse_html(STATS_PAGE).chunks, seen) if c.section_type == "facts"]
    second = [c for c in clean_chunks(parse_html(other).chunks, seen) if c.section_type == "facts"]
    assert len(first) == 4 and second == []  # same strip on every page is stored once


# --- split_text ------------------------------------------------------------

def test_split_text_sizes_and_overlap():
    text = "".join(chr(ord("a") + i % 26) for i in range(1200))
    chunks = split_text(text)
    step = CHUNK_SIZE - CHUNK_OVERLAP
    assert [len(c) for c in chunks] == [500, 500, 300]
    assert chunks[0] == text[:500]
    assert chunks[1] == text[step : step + 500]
    assert chunks[0][-CHUNK_OVERLAP:] == chunks[1][:CHUNK_OVERLAP]


def test_split_text_drops_tiny_tail_and_short_input():
    assert split_text("x" * 40) == []  # must be > 40 chars
    assert split_text("x" * 41) == ["x" * 41]
    # 450 step: a 480-char text leaves a 30-char tail which is dropped
    assert [len(c) for c in split_text("y" * 480)] == [480]
    assert split_text("") == []


def test_split_text_custom_size():
    assert [len(c) for c in split_text("z" * 250, size=100, overlap=10)] == [100, 100, 70]


# --- error pages ------------------------------------------------------------

@pytest.mark.parametrize(
    ("title", "text"),
    [
        ("404", "Nothing here"),
        ("Page Not Found | Acme", ""),
        ("Acme", "Sorry, the page you're looking for doesn't exist."),
        ("Acme", "This product is no longer available."),
        ("Acme", "This page has been moved."),
    ],
)
def test_error_pages(title, text):
    assert looks_like_error_page(title, text)


def test_error_probe_limited_to_first_400_chars():
    assert not looks_like_error_page("Acme", "x" * 400 + " page not found")
    assert not looks_like_error_page("Acme Pricing", "The Pro plan costs 29 dollars per month.")


# --- dedupe / cleaning --------------------------------------------------------

def test_content_hash_normalises():
    a = content_hash("[Home > About]\nOur team builds AI chatbots!")
    b = content_hash("our   team builds ai chatbots")
    assert a == b
    assert a != content_hash("Our team builds AI agents")
    assert len(a) == 64


def test_clean_chunks_drops_boilerplate_and_repeats():
    seen: set[str] = set()
    page1 = [
        Chunk("Pricing\nThe Pro plan costs 29 dollars per month.", "section", "Pricing"),
        Chunk("© 2025 Acme Inc. All rights reserved worldwide.", "body", ""),
        Chunk("Menu", "list-item", ""),
        Chunk("pricing -- the PRO plan costs 29 dollars per month", "section", "Pricing"),
    ]
    out1 = clean_chunks(page1, seen)
    assert [c.content for c in out1] == ["Pricing\nThe Pro plan costs 29 dollars per month."]
    # The same text on the next page of the same run is skipped too.
    page2 = [
        Chunk("Pricing\nThe Pro plan costs 29 dollars per month.", "section", "Pricing"),
        Chunk("About\nWe are a small team of engineers in Karachi.", "section", "About"),
    ]
    out2 = clean_chunks(page2, seen)
    assert [c.heading_path for c in out2] == ["About"]
    assert len(seen) == 2


# --- small helpers ------------------------------------------------------------

@pytest.mark.parametrize(
    ("url", "title", "kind"),
    [
        ("https://x.io/pricing", "", "pricing"),
        ("https://x.io/blog/post", "", "blog"),
        ("https://x.io/help", "", "docs"),
        ("https://x.io/shop/item", "", "product"),
        ("https://x.io/contact", "", "conversion"),
        ("https://x.io/about", "About us", "general"),
    ],
)
def test_detect_page_type(url, title, kind):
    assert detect_page_type(url, title) == kind


def test_url_category():
    assert url_category("https://x.io/services/ai/chatbots") == "services"
    assert url_category("https://x.io/") == "general"
    assert url_category("https://x.io") == "general"
