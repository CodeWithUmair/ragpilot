"""Dev-only helpers for the Playwright E2E suite. Every handler 404s in
production, so this can never become a user-creation backdoor."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Body
from sqlalchemy import delete, select

from app.auth.deps import DB
from app.auth.service import create_user
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Chatbot, ChatMessage, ChatSession, Lead, User
from app.services.email import captured_emails

router = APIRouter(prefix="/api/__test", include_in_schema=False)

CONVERSATION_NS = "e2e0c0nv0000000000000000000000ab"
ANALYTICS_NS = "e2e0a0a1ab1e000000000000000000ca"


def _dev_only() -> None:
    if get_settings().is_production:
        raise AppError("Not found", 404)


async def _user(db, email: str | None) -> User:
    if not email:
        raise AppError("email is required", 400)
    user = await db.scalar(select(User).where(User.email == email.lower()))
    if not user:
        raise AppError(f"no user with email {email}", 404)
    return user


async def _wipe_namespace(db, namespace: str) -> None:
    for model in (ChatMessage, ChatSession, Lead):
        await db.execute(delete(model).where(model.namespace == namespace))
    await db.execute(delete(Chatbot).where(Chatbot.embed_token == namespace))


@router.post("/seed-user")
async def seed_user(db: DB, email: str = Body(None), password: str = Body(None), name: str = Body(None)):
    _dev_only()
    if not (email and password and name):
        raise AppError("email, password, name are required", 400)
    await db.execute(delete(User).where(User.email == email.lower()))
    user = await create_user(db, email=email, name=name, password=password, email_verified=True)
    user.onboarding_completed = True  # land on /dashboard, not the onboarding wizard
    await db.commit()
    return {"user": {"id": user.id, "email": user.email, "name": user.name, "emailVerified": True, "plan": user.plan}}


@router.delete("/seed-user")
async def delete_seed_user(db: DB, email: str = Body(None, embed=True)):
    _dev_only()
    if not email:
        raise AppError("email is required", 400)
    await db.execute(delete(User).where(User.email == email.lower()))
    await db.commit()
    return {"success": True}


@router.get("/emails")
async def emails(to: str | None = None):
    _dev_only()
    return {"emails": captured_emails(to)}


@router.post("/seed-conversation")
async def seed_conversation(db: DB, email: str = Body(None, embed=True)):
    _dev_only()
    user = await _user(db, email)
    await _wipe_namespace(db, CONVERSATION_NS)
    question = "Does the conversation history load correctly?"
    answer = "Yes — this seeded reply proves the /chat/history endpoint and its CORS headers work end to end."
    bot = Chatbot(name="E2E Conversations Bot", url="https://e2e.conversations.test", embed_token=CONVERSATION_NS,
                  user_id=user.id, is_trained=True)
    db.add(bot)
    await db.flush()
    session_id = str(uuid.uuid4())
    db.add(ChatSession(session_id=session_id, namespace=CONVERSATION_NS, chatbot_id=bot.id,
                       chatbot_token=CONVERSATION_NS, visitor_id=str(uuid.uuid4()), first_question=question,
                       message_count=1))
    await db.flush()
    db.add(ChatMessage(session_id=session_id, namespace=CONVERSATION_NS, question=question, answer=answer))
    await db.commit()
    return {"namespace": CONVERSATION_NS, "sessionId": session_id, "question": question, "answer": answer,
            "chatbotName": bot.name}


@router.post("/seed-analytics")
async def seed_analytics(db: DB, email: str = Body(None, embed=True)):
    _dev_only()
    user = await _user(db, email)
    await _wipe_namespace(db, ANALYTICS_NS)
    bot = Chatbot(
        name="E2E Analytics Bot", url="https://e2e.analytics.test", embed_token=ANALYTICS_NS, user_id=user.id,
        is_trained=True,
        lead_config={
            "enabled": True, "fields": ["name", "email", "phone"], "required": ["email"], "trigger": "intent",
            "heading": "Want our team to follow up? Leave your details:",
            "successMessage": "Thanks! Our team will get back to you shortly.",
            "notifyEmail": True, "webhookUrl": "", "sheetUrl": "",
        },
    )
    db.add(bot)
    await db.flush()
    questions = ["What services do you offer?", "How much does the pro plan cost?", "Can I book a demo?",
                 "Where are you located?", "What services do you offer?"]
    total_messages, now = 0, datetime.now(UTC)
    for i in range(8):  # 8 sessions over ~12 days, 1-3 messages each, every 3rd one a lead
        started = now - timedelta(days=(i + 1) * 1.5)
        session_id, count = str(uuid.uuid4()), (i % 3) + 1
        db.add(ChatSession(
            session_id=session_id, namespace=ANALYTICS_NS, chatbot_id=bot.id, chatbot_token=ANALYTICS_NS,
            visitor_id=str(uuid.uuid4()), first_question=questions[i % len(questions)],
            host_page_url="https://e2e.analytics.test/pricing" if i % 2 == 0 else "https://e2e.analytics.test/",
            message_count=count, status="CLOSED", started_at=started, last_activity_at=started,
            last_user_message_at=started,
        ))
        await db.flush()
        for m in range(count):
            db.add(ChatMessage(session_id=session_id, namespace=ANALYTICS_NS,
                               question=questions[(i + m) % len(questions)], answer="Seeded analytics answer.",
                               created_at=started + timedelta(minutes=m)))
            total_messages += 1
        if i % 3 == 0:
            db.add(Lead(chatbot_id=bot.id, namespace=ANALYTICS_NS, session_id=session_id, name=f"Seed Lead {i}",
                        email=f"seed-lead-{i}@e2e.test", status="NEW" if i == 0 else "CONTACTED",
                        source="https://e2e.analytics.test/pricing", created_at=started))
    await db.commit()
    return {"namespace": ANALYTICS_NS, "chatbotId": bot.id, "chatbotName": bot.name, "sessions": 8,
            "messages": total_messages, "leads": 3}
