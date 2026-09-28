"""The chat agent's decisions, tested with fake models — no API key, no DB."""

from dataclasses import dataclass, field

import pytest

from app.lib.contact_extract import ExtractedContact
from app.rag.graph import ChatDeps, chat_graph
from app.rag.vector_store import Match

pytestmark = pytest.mark.asyncio

PRICING = "Pricing: the Pro plan costs $29 per month and includes 3 chatbots."


class FakeLLM:
    def __init__(self, answer="Sure!", rewrite_to="pro plan price"):
        self.answer, self.rewrite_to = answer, rewrite_to
        self.stream_calls: list[list[dict]] = []
        self.complete_calls = 0

    async def stream(self, messages, *, temperature, max_tokens):
        self.stream_calls.append(messages)
        for word in self.answer.split(" "):
            yield word + " "

    async def complete(self, messages, *, temperature, max_tokens):
        self.complete_calls += 1
        return self.rewrite_to


class FakeEmbedder:
    def __init__(self):
        self.queries: list[str] = []

    async def embed(self, texts):
        self.queries.extend(texts)
        return [[0.0] * 3 for _ in texts]


class FakeStore:
    """Scores are keyed by the query the embedder last saw."""

    def __init__(self, embedder: FakeEmbedder, scores: dict[str, float]):
        self.embedder, self.scores = embedder, scores

    async def search(self, embedding, namespace, top_k):
        score = self.scores.get(self.embedder.queries[-1], 0.2)
        return [Match(id="1", type="text", content=PRICING, score=score, raw_score=score, source="https://x.test/pricing")]

    async def upsert(self, records): ...
    async def delete_namespace(self, namespace): ...
    async def count(self, namespace): return 1


@dataclass
class FakeLeads:
    known: ExtractedContact = field(default_factory=ExtractedContact)
    captured: list[ExtractedContact] = field(default_factory=list)
    priorities: list[str] = field(default_factory=list)

    async def known_contact(self):
        return self.known

    async def capture(self, contact, *, priority="COLD"):
        self.captured.append(contact)
        self.priorities.append(priority)


async def run(question, history=(), *, scores=None, leads=None, lead_enabled=False, llm=None):
    embedder = FakeEmbedder()
    llm = llm or FakeLLM()
    deps = ChatDeps(
        llm=llm, embedder=embedder, store=FakeStore(embedder, scores or {}), leads=leads,
        namespace="ns", lead_config={
            "enabled": lead_enabled, "heading": "h", "fields": ["email"], "required": ["email"], "successMessage": "s",
        },
    )
    events, final = [], {}
    async for mode, chunk in chat_graph.astream(
        {"question": question, "history": list(history)},
        {"configurable": {"deps": deps}},
        stream_mode=["custom", "values"],
    ):
        if mode == "custom":
            events.append(chunk)
        else:
            final = chunk
    return events, final, embedder, llm


async def test_smalltalk_skips_retrieval():
    events, final, embedder, _ = await run("hi!")
    assert embedder.queries == []  # no embedding, no vector search
    assert final["route"] == "smalltalk"
    assert [e["event"] for e in events][0] == "sources"
    assert "".join(e["data"]["content"] for e in events if e["event"] == "delta").strip() == "Sure!"


async def test_confident_retrieval_answers_without_rewrite():
    history = [{"question": "what do you offer?", "answer": "Chatbots."}]
    _, final, embedder, llm = await run("pro plan pricing", history, scores={"pro plan pricing": 0.8})
    assert llm.complete_calls == 0
    assert embedder.queries == ["pro plan pricing"]
    assert final["sources"][0]["url"] == "https://x.test/pricing"


async def test_weak_followup_is_rewritten_and_retried_once():
    history = [{"question": "tell me about the pro plan", "answer": "It includes 3 chatbots."}]
    _, final, embedder, llm = await run(
        "how much is it?", history, scores={"how much is it?": 0.2, "pro plan price": 0.7}
    )
    assert llm.complete_calls == 1
    assert embedder.queries == ["how much is it?", "pro plan price"]
    assert final["search_query"] == "pro plan price"
    assert PRICING in llm.stream_calls[0][0]["content"]  # the rewritten search found the context


async def test_rewrite_loop_is_bounded():
    history = [{"question": "q", "answer": "a"}]
    _, _, embedder, llm = await run("and that?", history, scores={})  # every search is weak
    assert llm.complete_calls == 1
    assert len(embedder.queries) == 2


async def test_first_message_never_rewrites():
    _, _, embedder, llm = await run("how much is it?", scores={})
    assert llm.complete_calls == 0 and len(embedder.queries) == 1


async def test_lead_form_waits_for_a_qualifying_turn():
    events, _, _, _ = await run("I'm interested in pricing", lead_enabled=True, leads=FakeLeads())
    assert "lead" not in [e["event"] for e in events]

    history = [{"question": "what do you do?", "answer": "We build chatbots."}]
    events, final, _, _ = await run("I'm interested, how much?", history, lead_enabled=True, leads=FakeLeads())
    assert final["show_lead_form"] is True
    assert events[-1]["event"] == "lead"


async def test_volunteered_contact_is_captured_and_form_suppressed():
    leads = FakeLeads()
    history = [{"question": "what do you do?", "answer": "We build chatbots."}]
    events, final, _, llm = await run(
        "I'm interested, my name is Sara, reach me at sara@acme.io", history, lead_enabled=True, leads=leads
    )
    assert final["show_lead_form"] is False
    assert leads.captured[0].email == "sara@acme.io" and leads.captured[0].name == "Sara"
    assert "name: Sara" in llm.stream_calls[0][0]["content"]  # agent memory reached the prompt
    # Intent + a handle volunteered in the same message → HOT (docs/AGENT_VISION.md phase 1).
    assert leads.priorities[0] == "HOT"


async def test_known_contact_suppresses_form():
    leads = FakeLeads(known=ExtractedContact(name="Ali", email="ali@x.io"))
    history = [{"question": "hi", "answer": "hello"}]
    _, final, _, _ = await run("can I book a demo?", history, lead_enabled=True, leads=leads)
    assert final["show_lead_form"] is False


async def test_priority_is_cold_for_a_volunteered_name_without_intent():
    """Capturing a name is not itself buying intent — see D8/D17 in DECISIONS.md."""
    leads = FakeLeads()
    _, _, _, _ = await run("My name is Sara, by the way.", lead_enabled=True, leads=leads)
    assert leads.captured[0].name == "Sara"
    assert leads.priorities[0] == "COLD"


async def test_priority_is_warm_for_plain_intent_no_handle():
    leads = FakeLeads()
    history = [{"question": "what do you do?", "answer": "We build chatbots."}]
    await run("I'm interested, how much?", history, lead_enabled=True, leads=leads)
    assert leads.priorities[0] == "WARM"
