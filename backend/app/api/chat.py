"""Public chat endpoints used by the embeddable widget."""

import hashlib
import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from app.api.schemas import ChatMessageOut, ChatRequest, SessionOut
from app.auth.deps import DB, CurrentUser
from app.auth.service import client_ip
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Chatbot, ChatMessage, ChatSession, User
from app.db.session import SessionLocal
from app.lib.embed_token import is_embed_token
from app.lib.lead_config import resolve_lead_config
from app.lib.rate_limit import rate_limit
from app.lib.sse import SSE_HEADERS, SSE_MEDIA_TYPE, sse
from app.rag.graph import ChatDeps, chat_graph
from app.rag.providers import OpenAIChatModel, OpenAIEmbedder
from app.rag.vector_store import PgVectorStore
from app.services.leads import DbLeadStore, LeadOwner

log = logging.getLogger("ragpilot.chat")
router = APIRouter(prefix="/api", tags=["chat"])

LIMIT_REACHED = (
    "Sorry, this assistant is temporarily unavailable. The site owner has reached their monthly message "
    "limit. Please try again later or contact them directly."
)

# Stateless, so one instance serves every request.
_llm = None
_embedder = None


def _models():
    global _llm, _embedder
    if _llm is None:
        _llm, _embedder = OpenAIChatModel(), OpenAIEmbedder()
    return _llm, _embedder


async def _upsert_session(db, *, namespace, session_id, visitor_id, chatbot_id, token, host_page_url, ip, question):
    now = datetime.now(UTC).replace(tzinfo=None)
    stmt = insert(ChatSession.__table__).values(
        id=str(uuid.uuid4()), sessionId=session_id, namespace=namespace, chatbotId=chatbot_id,
        chatbotToken=token, hostPageUrl=host_page_url, ipAddress=ip, visitorId=visitor_id,
        firstQuestion=question, messageCount=1, status="ACTIVE",
        startedAt=now, lastActivityAt=now, lastUserMessageAt=now,
    )
    # First turn creates the row (and counts as message 1); later turns bump it.
    set_ = {"lastActivityAt": now, "lastUserMessageAt": now,
            "messageCount": ChatSession.__table__.c.messageCount + 1}
    if ip:
        set_["ipAddress"] = ip
    await db.execute(stmt.on_conflict_do_update(index_elements=["sessionId"], set_=set_))
    await db.commit()


@router.get("/chat", operation_id="chat_get", dependencies=[Depends(rate_limit("chat", 20, 60))])
@router.post("/chat", operation_id="chat_post", dependencies=[Depends(rate_limit("chat", 20, 60))])
async def chat(request: Request):
    if request.method == "GET":
        body = ChatRequest.model_validate(dict(request.query_params))
    else:
        body = ChatRequest.model_validate(await request.json())
    question = body.question.strip()
    if not question:
        raise AppError("question is required", 400)

    session_id = body.sessionId or str(uuid.uuid4())
    visitor_id = body.visitorId or str(uuid.uuid4())
    history = [t.model_dump() for t in body.history]
    ip = client_ip(request)

    async with SessionLocal() as db:
        bot, owner = None, None
        if body.token and is_embed_token(body.token):
            namespace = body.token
            row = (await db.execute(
                select(Chatbot, User).join(User, User.id == Chatbot.user_id).where(Chatbot.embed_token == body.token)
            )).first()
            if row:
                bot, owner = row
        elif body.url:
            # Legacy URL-only path: hash-of-URL namespaces no longer match any
            # chatbot, so this answers "no information" by design.
            namespace = hashlib.sha256(body.url.strip().encode()).hexdigest()[:32]
        else:
            raise AppError("token or url is required", 400)

    over_limit = bool(owner and owner.message_usage >= owner.message_limit)
    chatbot_id = bot.id if bot else None
    lead_owner = LeadOwner(bot.id, bot.name, bot.lead_config, owner.email) if bot and owner else None

    async def stream():
        # The generator owns its DB session: a request-scoped one would already
        # be closed while the body is still streaming.
        async with SessionLocal() as db:
            llm, embedder = _models()
            deps = ChatDeps(
                llm=llm, embedder=embedder, store=PgVectorStore(db), namespace=namespace,
                business_name=(bot.name or "").strip() or None if bot else None,
                persona=bot.system_prompt if bot else None,
                lead_config=resolve_lead_config(bot.lead_config if bot else None),
                leads=DbLeadStore(db, lead_owner, namespace=namespace, session_id=session_id,
                                  visitor_id=visitor_id, host_page_url=body.hostPageUrl) if lead_owner else None,
            )

            if over_limit:
                # Polite refusal instead of an error toast; the owner sees why in the dashboard.
                yield sse("sources", {"sources": []})
                for word in LIMIT_REACHED.split(" "):
                    yield sse("delta", {"content": word + " "})
                yield sse("done", {"sessionId": session_id, "namespace": namespace, "sources": [],
                                   "limitExceeded": True})
                return

            answer, sources = "", []
            try:
                await _upsert_session(db, namespace=namespace, session_id=session_id, visitor_id=visitor_id,
                                      chatbot_id=chatbot_id, token=body.token, host_page_url=body.hostPageUrl,
                                      ip=ip, question=question)
                async for mode, chunk in chat_graph.astream(
                    {"question": question, "history": history},
                    {"configurable": {"deps": deps}},
                    stream_mode=["custom", "values"],
                ):
                    if mode == "custom":
                        if chunk["event"] == "delta":
                            answer += chunk["data"]["content"]
                        elif chunk["event"] == "sources":
                            sources = chunk["data"]["sources"]
                        yield sse(chunk["event"], chunk["data"])
                error = None
            except Exception as exc:
                log.exception("chat failed")
                await db.rollback()
                # Provider errors can carry internals; the public widget gets a generic message.
                error = "Chat failed" if get_settings().is_production else (str(exc) or "Chat failed")

            # Persist BEFORE closing the stream (a partial answer on failure), so
            # a turn is never lost from the owner's Conversations view.
            try:
                db.add(ChatMessage(session_id=session_id, namespace=namespace, question=question, answer=answer))
                if owner and not error:
                    await db.execute(
                        update(User).where(User.id == owner.id).values(message_usage=User.message_usage + 1)
                    )
                await db.commit()
            except Exception:
                log.exception("saving chat turn failed")

            if error:
                yield sse("error", {"error": error})
            else:
                yield sse("done", {"sessionId": session_id, "namespace": namespace, "sources": sources})

    return StreamingResponse(stream(), media_type=SSE_MEDIA_TYPE, headers=SSE_HEADERS)


@router.get("/chat/history/{session_id}")
async def chat_history(session_id: str, db: DB, limit: int = 50):
    # Public: the widget resumes its own thread. Session ids are random UUIDs.
    rows = (await db.scalars(
        select(ChatMessage).where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at).limit(min(limit, 100))
    )).all()
    return {"messages": [ChatMessageOut.model_validate(m).model_dump(by_alias=True, mode="json") for m in rows]}


@router.get("/chat/conversations")
async def visitor_conversations(db: DB, token: str = "", visitorId: str = "", limit: int = 20):  # noqa: N803
    """A visitor's OWN threads for the widget's Messages tab — never the owner's inbox."""
    if not is_embed_token(token):
        raise AppError("a valid token is required", 400)
    if not visitorId:
        return {"conversations": []}
    sessions = (await db.scalars(
        select(ChatSession).where(ChatSession.namespace == token, ChatSession.visitor_id == visitorId)
        .order_by(ChatSession.last_activity_at.desc()).limit(min(limit, 50))
    )).all()
    conversations = []
    for s in sessions:
        last = await db.scalar(
            select(ChatMessage).where(ChatMessage.session_id == s.session_id)
            .order_by(ChatMessage.created_at.desc()).limit(1)
        )
        conversations.append({
            "sessionId": s.session_id,
            "title": s.first_question or "New conversation",
            "preview": (last.answer or last.question) if last else "",
            "messageCount": s.message_count,
            "startedAt": s.started_at.isoformat(),
            "lastActivityAt": (last.created_at if last else s.last_activity_at).isoformat(),
        })
    return {"conversations": conversations}


@router.get("/sessions/{namespace}")
async def list_sessions(namespace: str, user: CurrentUser, db: DB, page: int = 1, limit: int = 20):
    # Ownership check — the Express version let any signed-in user list any namespace.
    if not await db.scalar(select(Chatbot.id).where(Chatbot.embed_token == namespace, Chatbot.user_id == user.id)):
        raise AppError("Chatbot not found", 404)
    limit, page = min(limit, 100), max(page, 1)
    where = ChatSession.namespace == namespace
    sessions = (await db.scalars(
        select(ChatSession).where(where).order_by(ChatSession.last_activity_at.desc())
        .offset((page - 1) * limit).limit(limit)
    )).all()
    total = await db.scalar(select(func.count()).select_from(ChatSession).where(where))
    return {
        "sessions": [SessionOut.model_validate(s).model_dump(by_alias=True, mode="json") for s in sessions],
        "total": total, "page": page, "limit": limit,
    }
