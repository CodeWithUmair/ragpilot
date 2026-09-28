"""The chat agent as a LangGraph state machine.

    START → recall → route ─┬─ smalltalk ───────────────────────────┐
                            └─ knowledge → retrieve ─┬─ confident ──┤
                                    ▲                ├─ weak + follow-up → rewrite ─┐
                                    └────────────────┼──────────────────────────────┘
                                                     └─ weak, no retry left ─┤
                                                                   generate → capture_lead → END

Why a graph instead of the original straight-line function:
  * Follow-up questions ("how much is it?") used to be embedded verbatim, so
    retrieval found nothing and the bot said "I don't have that information"
    about something it had just described. `rewrite` turns the follow-up into
    a standalone query using the conversation — a LOOP back into retrieval,
    bounded to one retry. Loops are what a linear pipeline can't express cleanly.
  * Greetings ("hi", "thanks") no longer pay for an embedding + vector search
    that returns random chunks; `route` sends them straight to generation.
  * Each decision (route / retry / show the lead form) is a small pure node
    that is unit-tested with fake models — no OpenAI key, no database.

Tokens stream out of `generate` through LangGraph's custom stream writer, so
the HTTP layer forwards them as SSE while the graph is still running.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Literal, NotRequired, Protocol, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app.lib.contact_extract import ExtractedContact, extract_contact, has_contact_handle
from app.lib.lead_config import detect_lead_intent, score_lead_priority
from app.rag import retrieval
from app.rag.prompts import REWRITE_SYSTEM, build_system_prompt, history_messages
from app.rag.providers import ChatModel, Embedder
from app.rag.vector_store import Match, VectorStore

# Don't pop the lead form on the visitor's first message: the agent should
# qualify for at least one exchange first. `history` holds prior turns.
LEAD_FORM_MIN_PRIOR_TURNS = 1
MAX_REWRITES = 1

_SMALLTALK_RE = re.compile(
    r"^\s*(hi+|hello+|hey+|yo|hiya|salam|assalam[\w ]*|good (morning|afternoon|evening)|thanks?( you)?"
    r"|thank you( so much)?|thx|ok(ay)?|cool|great|nice|bye|goodbye|see you)[\s!.?,:)]*$",
    re.I,
)


class LeadStore(Protocol):
    """Persistence the agent needs for lead memory (implemented over the DB)."""

    async def known_contact(self) -> ExtractedContact: ...

    async def capture(self, contact: ExtractedContact, *, priority: str = "COLD") -> None: ...


@dataclass
class ChatDeps:
    """Per-request collaborators, passed via config["configurable"]["deps"]."""

    llm: ChatModel
    embedder: Embedder
    store: VectorStore
    leads: LeadStore | None = None
    namespace: str = ""
    business_name: str | None = None
    persona: str | None = None
    lead_config: dict[str, Any] = field(default_factory=lambda: {"enabled": False})


class ChatState(TypedDict):
    question: str
    history: list[dict]
    contact: NotRequired[ExtractedContact]
    route: NotRequired[Literal["smalltalk", "knowledge"]]
    search_query: NotRequired[str]
    rewrites: NotRequired[int]
    top_score: NotRequired[float]
    matches: NotRequired[list[Match]]
    sources: NotRequired[list[dict]]
    answer: NotRequired[str]
    show_lead_form: NotRequired[bool]


def _deps(config: RunnableConfig) -> ChatDeps:
    return config["configurable"]["deps"]


# ─── Nodes ────────────────────────────────────────────────────────────────────


async def recall(state: ChatState, config: RunnableConfig) -> dict:
    """Agent memory: what we already know about this visitor (a lead captured
    earlier in the session) merged with anything they just typed."""
    deps = _deps(config)
    typed = extract_contact(state["question"])
    known = await deps.leads.known_contact() if deps.leads else ExtractedContact()
    merged = ExtractedContact(
        name=typed.name or known.name,
        email=typed.email or known.email,
        phone=typed.phone or known.phone,
        company=typed.company or known.company,
    )
    return {"contact": merged}


def route(state: ChatState) -> dict:
    kind = "smalltalk" if _SMALLTALK_RE.match(state["question"]) else "knowledge"
    return {"route": kind, "search_query": state["question"], "rewrites": 0}


async def retrieve(state: ChatState, config: RunnableConfig) -> dict:
    deps = _deps(config)
    query = state.get("search_query") or state["question"]
    [embedding] = await deps.embedder.embed([query])
    raw = await deps.store.search(embedding, deps.namespace, retrieval.RETRIEVAL_POOL)
    # Rank against the ORIGINAL wording too: the lexical boost should reward the
    # visitor's own keywords, not only the rewrite's.
    matches = retrieval.select_context(f"{state['question']} {query}", raw)
    top = max((m.raw_score for m in raw), default=0.0)
    return {"matches": matches, "top_score": top}


async def rewrite(state: ChatState, config: RunnableConfig) -> dict:
    deps = _deps(config)
    transcript = "\n".join(
        f"Visitor: {t.get('question', '')}\nAssistant: {t.get('answer', '')}" for t in state["history"][-3:]
    )
    query = await deps.llm.complete(
        [
            {"role": "system", "content": REWRITE_SYSTEM},
            {"role": "user", "content": f"Conversation:\n{transcript}\n\nFollow-up: {state['question']}"},
        ],
        temperature=0,
        max_tokens=60,
    )
    return {"search_query": query or state["question"], "rewrites": state.get("rewrites", 0) + 1}


async def generate(state: ChatState, config: RunnableConfig) -> dict:
    deps = _deps(config)
    write = get_stream_writer()
    matches = state.get("matches", [])
    sources = retrieval.build_sources(matches)
    write({"event": "sources", "data": {"sources": sources}})

    system = build_system_prompt(
        persona=deps.persona,
        business_name=deps.business_name,
        lead_enabled=bool(deps.lead_config.get("enabled")),
        contact=state.get("contact", ExtractedContact()),
        context=retrieval.build_context(matches),
        smalltalk=state.get("route") == "smalltalk",
    )
    messages = [
        {"role": "system", "content": system},
        *history_messages(state["history"]),
        {"role": "user", "content": state["question"]},
    ]
    answer = ""
    async for delta in deps.llm.stream(messages, temperature=0.2, max_tokens=1500):
        answer += delta
        write({"event": "delta", "data": {"content": delta}})
    return {"answer": answer, "sources": sources}


async def capture_lead(state: ChatState, config: RunnableConfig) -> dict:
    """Behave like a sales agent, not a form-popping robot:
    (a) details the visitor VOLUNTEERED are captured silently — never re-asked;
    (b) the form appears only on real buying/contact intent, after at least one
        qualifying exchange, and only while we still have no way to reach them."""
    deps = _deps(config)
    cfg = deps.lead_config
    if not cfg.get("enabled"):
        return {"show_lead_form": False}

    question = state["question"]
    typed = extract_contact(question)
    intent = detect_lead_intent(question)
    has_handle_now = has_contact_handle(question)
    # Fire on intent too, not just a volunteered handle — a returning visitor
    # who already gave contact info can still upgrade their own priority by
    # showing urgency later in the conversation (capture() is upgrade-only,
    # see services/leads.py).
    if deps.leads and (has_handle_now or typed.name or typed.company or intent):
        priority = score_lead_priority(question, intent=intent, has_handle_now=has_handle_now)
        await deps.leads.capture(typed, priority=priority)

    contact = state.get("contact", ExtractedContact())
    show = (
        intent
        and len(state["history"]) >= LEAD_FORM_MIN_PRIOR_TURNS
        and not (contact.email or contact.phone)
        and not has_handle_now
    )
    if show:
        get_stream_writer()(
            {
                "event": "lead",
                "data": {k: cfg[k] for k in ("heading", "fields", "required", "successMessage")},
            }
        )
    return {"show_lead_form": show}


# ─── Edges ────────────────────────────────────────────────────────────────────


def after_route(state: ChatState) -> str:
    return "generate" if state["route"] == "smalltalk" else "retrieve"


def after_retrieve(state: ChatState) -> str:
    """Confident → answer. Weak on a follow-up → rewrite once and retry."""
    confident = state.get("top_score", 0.0) >= retrieval.CONFIDENT_SCORE
    can_retry = bool(state["history"]) and state.get("rewrites", 0) < MAX_REWRITES
    return "rewrite" if not confident and can_retry else "generate"


def build_chat_graph():
    g = StateGraph(ChatState)
    g.add_node("recall", recall)
    g.add_node("route", route)
    g.add_node("retrieve", retrieve)
    g.add_node("rewrite", rewrite)
    g.add_node("generate", generate)
    g.add_node("capture_lead", capture_lead)

    g.add_edge(START, "recall")
    g.add_edge("recall", "route")
    g.add_conditional_edges("route", after_route, ["retrieve", "generate"])
    g.add_conditional_edges("retrieve", after_retrieve, ["rewrite", "generate"])
    g.add_edge("rewrite", "retrieve")
    g.add_edge("generate", "capture_lead")
    g.add_edge("capture_lead", END)
    return g.compile()


chat_graph = build_chat_graph()
