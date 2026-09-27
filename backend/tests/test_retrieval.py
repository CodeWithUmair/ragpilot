"""app.rag.retrieval — spec: dl-chat-rag/backend/src/controllers/chat.controller.ts
(rerankMatches, gateByRelativeScore, the MIN_RAW_SCORE floor and source building)."""

import pytest

from app.rag.retrieval import (
    CONTEXT_CHUNKS,
    MIN_RAW_SCORE,
    RELATIVE_SCORE_MARGIN,
    build_context,
    build_sources,
    detect_intent,
    gate_by_relative_score,
    lexical_score,
    rerank,
    select_context,
)
from app.rag.vector_store import Match


def m(id, content, score, *, type="text", source=None, title=None, heading_path=None, raw=None):
    return Match(
        id=id, type=type, content=content, score=score, raw_score=score if raw is None else raw,
        source=source, title=title, heading_path=heading_path,
    )


def test_detect_intent():
    assert detect_intent("Show me your logo").wants_images
    assert detect_intent("what's the link to the pricing page?").wants_links
    i = detect_intent("How much does it cost?")
    assert not i.wants_images and not i.wants_links


def test_lexical_score_ignores_short_tokens_and_punctuation():
    assert lexical_score("AI is ok", "anything") == 0.0  # every token <= 2 chars
    assert lexical_score("chatbot pricing?", "Pricing: chatbot plans") == 1.0
    assert lexical_score("chatbot pricing", "our chatbot") == 0.5


def test_rerank_lexical_boost_reorders_equal_cosines():
    query = "pro plan pricing"
    a = m("a", "Our team is based in Karachi and works remotely worldwide.", 0.50)
    b = m("b", "Pricing: the Pro plan is $29 per month.", 0.50)
    ranked = rerank(query, [a, b])
    assert [x.id for x in ranked] == ["b", "a"]
    # b: full overlap (0.25) + text prior (0.05); a: only the text prior
    assert ranked[0].score == pytest.approx(0.50 + 0.25 + 0.05)
    assert ranked[1].score == pytest.approx(0.50 + 0.05)
    # raw cosine untouched, input not mutated
    assert ranked[0].raw_score == 0.50 and b.score == 0.50


def test_rerank_type_priors():
    img = m("img", "company logo", 0.40, type="image")
    txt = m("txt", "unrelated words entirely", 0.40)
    assert rerank("show the logo", [txt, img])[0].id == "img"
    link = m("link", "zzz", 0.40, type="link")
    assert rerank("link please", [link])[0].score == pytest.approx(0.40 + 0.08)
    other = m("o", "zzz", 0.40, type="product")
    assert rerank("hello there", [other])[0].score == pytest.approx(0.40)


def test_relative_gate_keeps_top_and_near_matches():
    top = m("top", "x", 0.90)
    near = m("near", "x", 0.90 - RELATIVE_SCORE_MARGIN + 0.01)
    far = m("far", "x", 0.90 - RELATIVE_SCORE_MARGIN - 0.01)
    assert [x.id for x in gate_by_relative_score([top, near, far])] == ["top", "near"]


def test_relative_gate_always_keeps_a_lone_or_weak_top():
    assert gate_by_relative_score([]) == []
    lone = [m("only", "x", 0.01)]
    assert gate_by_relative_score(lone) == lone


def test_floor_drops_noise_by_raw_score():
    q = "pricing"
    noise = m("noise", "Pricing pricing pricing, our pricing page is lovely.", 0.9, raw=MIN_RAW_SCORE - 0.01)
    ok = m("ok", "The Pro plan pricing is $29 per month for everyone.", MIN_RAW_SCORE, raw=MIN_RAW_SCORE)
    # noise has a huge boosted score but its raw cosine is below the floor
    assert [x.id for x in select_context(q, [noise, ok])] == ["ok"]


def test_select_context_nothing_above_floor():
    assert select_context("anything", [m("a", "Some long enough content goes here ok.", 0.1)]) == []


def test_adjacent_topic_bleed_blockchain_vs_ai():
    """Asking about AI services must not pull in blockchain chunks that only
    share the word "services" (the bot used to pitch blockchain)."""
    query = "What AI development services do you offer?"
    ai = m("ai", "We offer AI development services: custom LLM apps, RAG chatbots and agents.", 0.62)
    ai2 = m("ai2", "Our AI development team ships production chatbots in weeks.", 0.55)
    chain = m("chain", "Our blockchain services include smart contracts and token launches.", 0.40)
    noise = m("noise", "Our office is open Monday to Friday from nine to five.", 0.10)
    footer = m("footer", "© 2025 Acme Inc. All rights reserved. Privacy | Terms", 0.70)
    out = select_context(query, [footer, ai, chain, ai2, noise])
    ids = [x.id for x in out]
    assert ids == ["ai", "ai2"]
    assert "chain" not in ids


def test_select_context_dedupes_and_caps():
    matches = [m(f"c{i}", f"Distinct chunk number {i} about the pro plan pricing.", 0.60) for i in range(20)]
    matches.insert(1, m("dup", "[Pricing] distinct chunk number 0 about the PRO plan pricing!", 0.60))
    out = select_context("pro plan pricing", matches)
    assert len(out) == CONTEXT_CHUNKS
    assert "dup" not in [x.id for x in out]


def test_build_context():
    ctx = build_context(
        [
            m("a", "Alpha content", 0.9, heading_path="Pricing > Pro", source="https://x.io/pricing"),
            m("b", "Beta content", 0.8),
        ]
    )
    assert ctx == "[Pricing > Pro]\nAlpha content\nSource: https://x.io/pricing\n\n---\n\nBeta content"


def test_build_sources_threshold_and_limit():
    matches = [m(f"s{i}", "c", 0.9 - i * 0.01, source=f"https://x.io/{i}") for i in range(7)]
    matches += [
        m("exact", "c", 0.5, source="https://x.io/half"),  # threshold is strict (> 0.5)
        m("nosrc", "c", 0.99),
    ]
    matches.insert(0, m("nosrc2", "c", 0.99))
    out = build_sources(matches)
    assert [s["url"] for s in out] == [f"https://x.io/{i}" for i in range(5)]
    assert out[0] == {"url": "https://x.io/0", "title": "https://x.io/0", "type": "text", "score": 0.9}


def test_build_sources_uses_title_and_excludes_low_scores():
    out = build_sources(
        [m("a", "c", 0.7, source="https://x.io/a", title="About us"), m("b", "c", 0.5, source="https://x.io/b")]
    )
    assert out == [{"url": "https://x.io/a", "title": "About us", "type": "text", "score": 0.7}]
