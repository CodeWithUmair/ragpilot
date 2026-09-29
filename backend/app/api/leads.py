import csv
import io
import re

from fastapi import APIRouter, BackgroundTasks, Depends, Response
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from app.api.chatbots import owned_chatbot
from app.api.schemas import LeadCreate, LeadOut, LeadStatusIn, TestForwardIn
from app.auth.deps import DB, CurrentUser
from app.core.errors import AppError
from app.db.models import Chatbot, Lead, User
from app.lib.embed_token import is_embed_token
from app.lib.lead_config import PRIORITY_RANK
from app.lib.rate_limit import rate_limit
from app.services.leads import LeadOwner, clean, forward_lead, send_test_lead

router = APIRouter(prefix="/api", tags=["leads"])


def lead_out(lead: Lead) -> dict:
    return LeadOut.model_validate(lead).model_dump(by_alias=True, mode="json")


@router.post("/leads", status_code=201, dependencies=[Depends(rate_limit("leads", 10, 60))])
async def create_lead(body: LeadCreate, background: BackgroundTasks, db: DB):
    """Public: the widget's lead form."""
    if not is_embed_token(body.token):
        raise AppError("A valid chatbot token is required", 400)
    if not clean(body.email) and not clean(body.phone):
        raise AppError("An email or phone number is required", 400)
    row = (await db.execute(
        select(Chatbot, User.email).join(User, User.id == Chatbot.user_id).where(Chatbot.embed_token == body.token)
    )).first()
    if not row:
        raise AppError("Chatbot not found", 404)
    bot, owner_email = row

    data = {
        "chatbot_id": bot.id, "namespace": bot.embed_token, "session_id": clean(body.sessionId),
        "visitor_id": clean(body.visitorId), "name": clean(body.name), "email": clean(body.email),
        "phone": clean(body.phone), "company": clean(body.company), "message": clean(body.message),
        "fields": body.fields, "source": clean(body.hostPageUrl),
    }
    # A double-click / refresh from the same session updates the lead instead
    # of duplicating it — and is NOT forwarded to the owner a second time.
    existing = data["session_id"] and await db.scalar(
        select(Lead).where(Lead.chatbot_id == bot.id, Lead.session_id == data["session_id"])
    )
    if existing:
        for key, value in data.items():
            setattr(existing, key, value)
        # Filling out the form is intent by itself (see docs/AGENT_VISION.md
        # phase 1) — upgrade-only, same rule as the chat-captured path.
        if PRIORITY_RANK["WARM"] > PRIORITY_RANK.get(existing.priority, 0):
            existing.priority = "WARM"
        await db.commit()
        return JSONResponse({"success": True, "leadId": existing.id, "deduped": True}, status_code=200)

    lead = Lead(**data, priority="WARM")
    db.add(lead)
    await db.commit()
    # Runs after the response is sent — the visitor never waits on SMTP/webhooks.
    background.add_task(forward_lead, lead.id, LeadOwner(bot.id, bot.name, bot.lead_config, owner_email))
    return {"success": True, "leadId": lead.id}


@router.get("/chatbots/{chatbot_id}/leads")
async def list_leads(chatbot_id: str, user: CurrentUser, db: DB, page: int = 1, limit: int = 30,
                     status: str | None = None, priority: str | None = None):
    await owned_chatbot(db, user.id, chatbot_id)
    page, limit = max(page, 1), min(limit, 100)
    query = select(Lead).where(Lead.chatbot_id == chatbot_id)
    if status:
        query = query.where(Lead.status == status)
    if priority:
        query = query.where(Lead.priority == priority)
    leads = (await db.scalars(query.order_by(Lead.created_at.desc()).offset((page - 1) * limit).limit(limit))).all()
    count = select(func.count()).select_from(Lead).where(Lead.chatbot_id == chatbot_id)
    return {
        "leads": [lead_out(lead) for lead in leads],
        "total": await db.scalar(count),
        "newCount": await db.scalar(count.where(Lead.status == "NEW")),
        "page": page, "limit": limit,
    }


@router.patch("/chatbots/{chatbot_id}/leads/{lead_id}")
async def update_lead(chatbot_id: str, lead_id: str, body: LeadStatusIn, user: CurrentUser, db: DB):
    lead = await db.scalar(
        select(Lead).join(Chatbot, Chatbot.id == Lead.chatbot_id).where(Lead.id == lead_id, Chatbot.user_id == user.id)
    )
    if not lead:
        raise AppError("Lead not found", 404)
    lead.status = body.status
    await db.commit()
    return {"lead": lead_out(lead)}


@router.post("/chatbots/{chatbot_id}/leads/test-forward")
async def test_forward(chatbot_id: str, body: TestForwardIn, user: CurrentUser, db: DB):
    bot = await owned_chatbot(db, user.id, chatbot_id)
    result = await send_test_lead(LeadOwner(bot.id, bot.name, bot.lead_config, user.email), body.destination, body.url)
    return JSONResponse(result, status_code=200 if result["ok"] else 502)


@router.get("/chatbots/{chatbot_id}/leads/export")
async def export_leads(chatbot_id: str, user: CurrentUser, db: DB):
    bot = await owned_chatbot(db, user.id, chatbot_id)
    leads = (await db.scalars(select(Lead).where(Lead.chatbot_id == chatbot_id).order_by(Lead.created_at.desc()))).all()
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(["createdAt", "name", "email", "phone", "company", "message", "status", "priority", "source"])
    for lead in leads:
        writer.writerow([lead.created_at.isoformat(), lead.name or "", lead.email or "", lead.phone or "",
                         lead.company or "", lead.message or "", lead.status, lead.priority, lead.source or ""])
    safe = re.sub(r"[^a-z0-9]+", "-", bot.name, flags=re.I).lower()
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="leads-{safe}.csv"'})
