"""HTML → structured, chunked text ready to embed.

CPU-bound (lxml parsing), so callers run it in a worker thread via
asyncio.to_thread — parsing 5 pages concurrently must not block the event loop
that is also streaming progress to the browser.
"""

import hashlib
import re
from dataclasses import dataclass
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from app.lib.text_clean import CHROME_SELECTORS, collapse_ws, is_boilerplate, normalize_for_dedup

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
MIN_CHUNK_CHARS = 40
MIN_BLOCK_CHARS = 20


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def content_hash(content: str) -> str:
    """Content-based (not per-URL) so identical text across pages collapses to
    one row via ON CONFLICT (namespace, contentHash)."""
    return sha256(f"text:{normalize_for_dedup(content)}")


def split_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    chunks, i = [], 0
    while i < len(text):
        chunk = text[i : i + size].strip()
        if len(chunk) > MIN_CHUNK_CHARS:
            chunks.append(chunk)
        i += size - overlap
    return chunks


def detect_page_type(url: str, title: str) -> str:
    target = f"{url} {title}".lower()
    for pattern, kind in (
        (r"\bpricing\b", "pricing"),
        (r"\b(blog|article|news)\b", "blog"),
        (r"\b(doc|docs|guide|help|faq|support)\b", "docs"),
        (r"\b(product|shop|store|collection)\b", "product"),
        (r"\b(contact|demo|book)\b", "conversion"),
    ):
        if re.search(pattern, target):
            return kind
    return "general"


def url_category(url: str) -> str:
    try:
        parts = [p for p in urlparse(url).path.split("/") if p]
    except ValueError:
        return "general"
    return parts[0] if parts else "general"


_ERROR_PAGE_RE = re.compile(
    r"\bpage not found\b|\b404\b|the page you('?re| are| were)? looking for|does(n'?t| not) exist"
    r"|has been moved|no longer (exists|available)"
)


def looks_like_error_page(title: str, text: str) -> bool:
    """Soft-404s often return 200; their "page not found" text used to surface as answers."""
    return bool(_ERROR_PAGE_RE.search(f"{title} {text[:400]}".lower()))


@dataclass
class Chunk:
    content: str
    section_type: str
    heading_path: str


@dataclass
class ParsedPage:
    title: str
    text: str
    description: str
    lang: str
    chunks: list[Chunk]


def _sections(body) -> list[Chunk]:
    """Walk headings/paragraphs/list items/cells in document order, carrying a
    heading path ("Pricing > Pro plan") so each chunk keeps its context, and
    pairing a question-like heading with the paragraph under it as an FAQ."""
    sections: list[Chunk] = []
    stack: list[str] = []
    pending_faq = ""
    for el in body.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th"]):
        text = collapse_ws(el.get_text(" "))
        if el.name[0] == "h" and el.name[1:].isdigit():
            if len(text) < 2:
                continue
            level = int(el.name[1])
            stack = stack[: level - 1] + [""] * max(0, level - 1 - len(stack)) + [text]
            if text.endswith("?"):
                pending_faq = text
            continue
        if len(text) < MIN_BLOCK_CHARS:
            continue
        heading_path = " > ".join(h for h in stack if h)
        if pending_faq and el.name == "p":
            section_type = "faq"
        elif el.name == "li":
            section_type = "list-item"
        elif el.name in ("td", "th"):
            section_type = "table"
        else:
            section_type = "section" if heading_path else "body"

        if section_type == "faq":
            content = f"Question: {pending_faq}\nAnswer: {text}"
            pending_faq = ""
        else:
            content = f"{heading_path}\n{text}" if heading_path else text
        sections.append(Chunk(content, section_type, heading_path))
    return sections


# "12+", "$3M+", "70%+", "2,000+", "4.8/5": the number half of a stat counter.
_STAT_NUMBER = re.compile(r"^[$€£]?\s?\d[\d.,]*\s?[kmb]?%?\+?(/\d+)?$", re.I)
_NON_TEXT = {"svg", "img", "picture", "script", "style", "noscript"}
MAX_STAT_LABEL_CHARS = 60
MAX_DEFINITION_CHARS = 200


def _fact(a: str, b: str) -> str:
    return f"{a} {b}" if _STAT_NUMBER.match(a) else f"{a}: {b}"


def _key_facts(body) -> list[str]:
    """Stat counters ("12+" / "Countries Served") and <dl> term/value pairs.

    _sections never sees these: each half is under MIN_BLOCK_CHARS or sits in a
    <span>/<dt>/<dd> it doesn't walk, so "how many countries / which region /
    how many properties" got "I don't have that information" on a site that
    states it (eval run 2026-11-19: 8 of 11 misses). Pairs are grouped by their
    container into one chunk, so a stat strip repeated on every page has
    identical content and clean_chunks stores it once."""
    groups: dict[int, list[str]] = {}
    for el in body.find_all(True):
        if el.name == "dl":  # plain <dl><dt/><dd/>…</dl>, no wrapper divs
            kids = [c for c in el.find_all(recursive=False) if c.name in ("dt", "dd")]
            for dt, dd in zip(kids[::2], kids[1::2], strict=False):
                a, b = collapse_ws(dt.get_text(" ")), collapse_ws(dd.get_text(" "))
                if dt.name == "dt" and dd.name == "dd" and a and b and len(b) <= MAX_DEFINITION_CHARS:
                    groups.setdefault(id(el), []).append(_fact(a, b))
            continue
        kids = [c for c in el.find_all(recursive=False) if c.name not in _NON_TEXT]
        if len(kids) != 2:
            continue
        a, b = (collapse_ws(k.get_text(" ")) for k in kids)
        if not (a and b):
            continue
        is_definition = {k.name for k in kids} == {"dt", "dd"} and len(a + b) <= MAX_DEFINITION_CHARS
        is_stat = _STAT_NUMBER.match(a) and len(b) <= MAX_STAT_LABEL_CHARS
        if is_definition or is_stat:
            groups.setdefault(id(el.parent), []).append(_fact(a, b))
    return ["Key facts: " + "; ".join(items) for items in groups.values()]


def parse_html(html: str) -> ParsedPage:
    soup = BeautifulSoup(html, "lxml")
    title = collapse_ws(soup.title.get_text()) if soup.title else ""
    description = ""
    if (meta := soup.find("meta", attrs={"name": "description"})) and meta.get("content"):
        description = str(meta["content"])
    lang = str(soup.html.get("lang", "unknown")) if soup.html else "unknown"

    body = soup.body or soup
    # Strip nav/header/footer/cookie chrome so the same menu isn't ingested per page.
    for el in body.select(CHROME_SELECTORS):
        el.decompose()
    text = collapse_ws(body.get_text(" "))

    sections = _sections(body)
    if sections:
        chunks = [Chunk(piece, s.section_type, s.heading_path) for s in sections for piece in split_text(s.content)]
    else:
        chunks = [Chunk(piece, "body", "") for piece in split_text(text)]
    title = title or "Untitled"
    # "[Title]" puts the page's subject into the embedding ("Key facts: $3M+ raised" alone never
    # matched "How much did Degen Forest raise?"), while normalize_for_dedup strips bracketed
    # labels, so a stat strip shown on every page still hashes the same and is stored once.
    label = f"[{title}]\n"
    chunks += [Chunk(label + fact, "facts", title) for fact in _key_facts(body)]
    # Sites often state a fact only in the meta description ("We respond in under 5 minutes").
    if len(description) >= MIN_BLOCK_CHARS:
        chunks.append(Chunk(label + collapse_ws(description), "description", title))
    return ParsedPage(title=title, text=text, description=description, lang=lang, chunks=chunks)


def clean_chunks(chunks: list[Chunk], seen_hashes: set[str]) -> list[Chunk]:
    """Drop boilerplate and chunks already indexed in this run — BEFORE
    embedding, so we never pay to embed junk we would throw away."""
    out = []
    for c in chunks:
        if is_boilerplate(c.content):
            continue
        h = content_hash(c.content)
        if h in seen_hashes:
            continue
        seen_hashes.add(h)
        out.append(c)
    return out
