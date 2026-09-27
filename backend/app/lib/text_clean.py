"""Keep site chrome and error pages out of the index AND out of the prompt.

Two layers use this:
  - ingestion drops boilerplate chunks before paying to embed them and dedupes
    identical text so the same footer isn't stored once per page;
  - retrieval re-filters matches, so even already-polluted data can't crowd a
    real answer out of the context window.

Root cause it fixes: the first crawler indexed <footer>/<nav>/404 text with a
per-page hash, so "© 2025 …" became dozens of vectors that dominated
similarity search and starved the model of the actual answer (the "it just
hallucinates" reports). Patterns stay HIGH-PRECISION: better to let a
borderline chunk through than silently drop real content.
"""

import re
from collections.abc import Callable, Iterable

_BOILERPLATE = [
    re.compile(p, re.I)
    for p in (
        r"all rights reserved",
        r"©\s*\d{4}",
        r"\(c\)\s*\d{4}",
        r"\bprivacy policy\b\s*[|·•-]?\s*\bterms\b",
        # 404 / soft-404 pages that get crawled as if they were content
        r"\bpage not found\b",
        r"\b404\b.*(error|not found)",
        r"the page you('?re| are| were)? looking for",
        r"page (you (are|were) looking for|requested).{0,40}(does(n'?t| not) exist|can('?t|not) be found"
        r"|was not found|has been moved|moved or deleted)",
        r"does(n'?t| not) exist or has been moved",
        # cookie / consent / JS-required banners
        r"we use cookies|cookie (policy|preferences|consent)|accept (all )?cookies",
        r"please enable (javascript|cookies)|you need to enable javascript",
    )
]

_WS = re.compile(r"\s+")


def collapse_ws(text: str) -> str:
    return _WS.sub(" ", text).strip()


def is_boilerplate(content: str) -> bool:
    text = collapse_ws(content)
    if len(text) < 25:  # nav labels, button text, "Read more"
        return True
    return any(p.search(text) for p in _BOILERPLATE)


def normalize_for_dedup(content: str) -> str:
    """Lowercase, drop "[Heading > Path]" labels and punctuation, collapse
    whitespace — so one footer captured on 50 pages collapses to one key."""
    text = re.sub(r"\[[^\]]*\]", " ", content.lower())
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return collapse_ws(text)


def dedupe_content[T](items: Iterable[T], get_text: Callable[[T], str]) -> list[T]:
    """Drop boilerplate and keep the first (highest-ranked) copy of each text."""
    seen: set[str] = set()
    out: list[T] = []
    for item in items:
        text = get_text(item)
        if is_boilerplate(text):
            continue
        key = normalize_for_dedup(text)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


# Page chrome removed before extracting text.
CHROME_SELECTORS = ", ".join(
    [
        "script", "style", "noscript", "template", "svg",
        "nav", "header", "footer", "aside",
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="search"]',
        ".nav", ".navbar", ".navigation", ".menu", ".mega-menu",
        ".header", ".site-header", ".top-bar",
        ".footer", ".site-footer", ".footer-menu",
        ".breadcrumb", ".breadcrumbs",
        ".cookie", ".cookies", ".cookie-banner", ".cookie-consent", ".consent",
        ".skip-link", ".sr-only",
    ]
)
