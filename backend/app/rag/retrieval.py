"""Post-retrieval ranking: noise floor → hybrid rerank → dedupe → relative gate.

Every constant here was tuned against a real failure (see comments), which is
why they are named and documented instead of inlined.
"""

import re
from dataclasses import dataclass, replace

from app.lib.text_clean import dedupe_content
from app.rag.vector_store import Match

# Wide candidate pool: many indexed chunks are near-duplicate site chrome, so a
# narrow pool can be left with too little real context after dedupe.
RETRIEVAL_POOL = 40
CONTEXT_CHUNKS = 12
# pgvector always returns RETRIEVAL_POOL rows, even wholly unrelated ones.
# Below this raw cosine a chunk is noise; feeding it to the model invites
# hallucinated answers to off-topic questions.
MIN_RAW_SCORE = 0.18
# After reranking, drop anything trailing the best match by more than this.
# Fixes "adjacent-topic bleed": asking about "AI development services" also
# pulled weaker "blockchain services" chunks (shared word "services") and the
# bot cheerfully pitched blockchain.
RELATIVE_SCORE_MARGIN = 0.22
# A top raw cosine at or above this means retrieval found something genuinely
# on-topic. Below it (and above MIN_RAW_SCORE) the graph tries a query rewrite.
CONFIDENT_SCORE = 0.35
SOURCE_MIN_SCORE = 0.5


@dataclass
class QueryIntent:
    wants_images: bool
    wants_links: bool


def detect_intent(query: str) -> QueryIntent:
    q = query.lower()
    return QueryIntent(
        wants_images=bool(re.search(r"\b(image|picture|photo|show|visual|look|icon|logo)\b", q)),
        wants_links=bool(re.search(r"\b(link|url|page|website|visit|go to)\b", q)),
    )


def _tokens(value: str) -> set[str]:
    return {t for t in re.sub(r"[^a-z0-9\s]", " ", value.lower()).split() if len(t) > 2}


def lexical_score(query: str, candidate: str) -> float:
    q = _tokens(query)
    if not q:
        return 0.0
    return len(q & _tokens(candidate)) / len(q)


def rerank(query: str, matches: list[Match]) -> list[Match]:
    """Hybrid score: cosine + keyword overlap + a small content-type prior."""
    intent = detect_intent(query)

    def boosted(m: Match) -> Match:
        if intent.wants_images and m.type == "image":
            type_boost = 0.2
        elif intent.wants_links and m.type == "link":
            type_boost = 0.08
        elif m.type in ("text", "document", "faq"):
            type_boost = 0.05
        else:
            type_boost = 0.0
        return replace(m, score=m.score + lexical_score(query, m.content) * 0.25 + type_boost)

    return sorted((boosted(m) for m in matches), key=lambda m: m.score, reverse=True)


def gate_by_relative_score(matches: list[Match]) -> list[Match]:
    if len(matches) <= 1:
        return matches
    top = matches[0].score
    return [m for i, m in enumerate(matches) if i == 0 or m.score >= top - RELATIVE_SCORE_MARGIN]


def select_context(query: str, raw_matches: list[Match]) -> list[Match]:
    above_floor = [m for m in raw_matches if m.raw_score >= MIN_RAW_SCORE]
    ranked = rerank(query, above_floor)
    deduped = dedupe_content(ranked, lambda m: m.content)
    return gate_by_relative_score(deduped)[:CONTEXT_CHUNKS]


def build_context(matches: list[Match]) -> str:
    parts = []
    for m in matches:
        prefix = f"[{m.heading_path}]\n" if m.heading_path else ""
        source = f"\nSource: {m.source}" if m.source else ""
        parts.append(f"{prefix}{m.content}{source}")
    return "\n\n---\n\n".join(parts)


def build_sources(matches: list[Match]) -> list[dict]:
    return [
        {"url": m.source, "title": m.title or m.source, "type": m.type, "score": m.score}
        for m in matches
        if m.source and m.score > SOURCE_MIN_SCORE
    ][:5]
