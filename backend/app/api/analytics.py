"""Dashboard analytics for one chatbot or all of a user's chatbots: totals with
the previous period for deltas, a zero-filled daily series, hourly activity,
top questions/pages, lead status breakdown and a per-bot summary.

Everything is scoped to the caller's own chatbots first, so one user can
never read another user's metrics."""

from collections import Counter
from datetime import UTC, datetime, time, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.auth.deps import DB, CurrentUser
from app.core.errors import AppError
from app.db.models import Chatbot, ChatMessage, ChatSession, Lead

router = APIRouter(prefix="/api", tags=["analytics"])

MAX_RANGE_DAYS = 366
DEFAULT_RANGE_DAYS = 30


def _parse(value: str | None) -> datetime | None:
    if not value or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _range(from_: str | None, to: str | None) -> tuple[datetime, datetime]:
    end = _parse(to) or datetime.now(UTC)
    start = _parse(from_) or end - timedelta(days=DEFAULT_RANGE_DAYS - 1)
    if start > end:
        start, end = end, start
    if end - start > timedelta(days=MAX_RANGE_DAYS):
        start = end - timedelta(days=MAX_RANGE_DAYS)
    # The UI sends date-only values: cover whole days.
    return (datetime.combine(start.date(), time.min, UTC), datetime.combine(end.date(), time.max, UTC))


async def _count(db, model, column, where, lo, hi) -> int:
    return await db.scalar(select(func.count()).select_from(model).where(where, column >= lo, column <= hi))


async def _top(db, column, where, lo, hi, started, limit: int):
    rows = await db.execute(
        select(column, func.count().label("n")).where(where, column.is_not(None), started >= lo, started <= hi)
        .group_by(column).order_by(func.count().desc()).limit(limit)
    )
    return [(value, n) for value, n in rows if value]


@router.get("/analytics")
async def analytics(user: CurrentUser, db: DB, chatbotId: str | None = None,  # noqa: N803
                    from_: str | None = Query(None, alias="from"), to: str | None = None):
    bot_filter = chatbotId if chatbotId and chatbotId != "all" else None
    query = select(Chatbot.id, Chatbot.name, Chatbot.embed_token).where(Chatbot.user_id == user.id)
    if bot_filter:
        query = query.where(Chatbot.id == bot_filter)
    bots = (await db.execute(query)).all()
    if bot_filter and not bots:
        raise AppError("Chatbot not found", 404)

    start, end = _range(from_, to)
    prev_end = start - timedelta(microseconds=1)
    prev_start = prev_end - (end - start)
    namespaces = [b.embed_token for b in bots]
    bot_ids = [b.id for b in bots]

    in_ns = ChatSession.namespace.in_(namespaces)
    msg_ns = ChatMessage.namespace.in_(namespaces)
    lead_bots = Lead.chatbot_id.in_(bot_ids)

    sessions = (await db.execute(
        select(ChatSession.started_at, ChatSession.visitor_id, ChatSession.namespace)
        .where(in_ns, ChatSession.started_at >= start, ChatSession.started_at <= end)
    )).all() if bots else []
    message_times = (await db.scalars(
        select(ChatMessage.created_at).where(msg_ns, ChatMessage.created_at >= start, ChatMessage.created_at <= end)
    )).all() if bots else []
    leads = (await db.execute(
        select(Lead.created_at, Lead.chatbot_id, Lead.status)
        .where(lead_bots, Lead.created_at >= start, Lead.created_at <= end)
    )).all() if bots else []

    previous = {"conversations": 0, "messages": 0, "leads": 0}
    top_questions, top_pages = [], []
    if bots:
        previous = {
            "conversations": await _count(db, ChatSession, ChatSession.started_at, in_ns, prev_start, prev_end),
            "messages": await _count(db, ChatMessage, ChatMessage.created_at, msg_ns, prev_start, prev_end),
            "leads": await _count(db, Lead, Lead.created_at, lead_bots, prev_start, prev_end),
        }
        top_questions = await _top(db, ChatSession.first_question, in_ns, start, end, ChatSession.started_at, 8)
        top_pages = await _top(db, ChatSession.host_page_url, in_ns, start, end, ChatSession.started_at, 6)

    # Zero-filled daily buckets (UTC) so charts get a continuous axis.
    days, day = [], start.date()
    while day <= end.date():
        days.append(day.isoformat())
        day += timedelta(days=1)
    conv_by_day = Counter(s.started_at.date().isoformat() for s in sessions)
    msg_by_day = Counter(t.date().isoformat() for t in message_times)
    lead_by_day = Counter(lead.created_at.date().isoformat() for lead in leads)
    hourly = Counter(t.hour for t in message_times)
    conv_by_ns = Counter(s.namespace for s in sessions)
    leads_by_bot = Counter(lead.chatbot_id for lead in leads)

    conversations = len(sessions)
    return {
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "totals": {
            "conversations": conversations,
            "messages": len(message_times),
            "leads": len(leads),
            "visitors": len({s.visitor_id for s in sessions}),
            "conversionRate": len(leads) / conversations if conversations else 0,
        },
        "previous": previous,
        "series": [
            {"date": d, "conversations": conv_by_day[d], "messages": msg_by_day[d], "leads": lead_by_day[d]}
            for d in days
        ],
        "hourly": [{"hour": h, "messages": hourly[h]} for h in range(24)],
        "leadStatus": [{"status": s, "count": n} for s, n in Counter(lead.status for lead in leads).items()],
        "topQuestions": [{"question": q, "count": n} for q, n in top_questions],
        "topPages": [{"page": p, "count": n} for p, n in top_pages],
        "bots": sorted(
            ({"id": b.id, "name": b.name, "conversations": conv_by_ns[b.embed_token], "leads": leads_by_bot[b.id]}
             for b in bots),
            key=lambda b: b["conversations"], reverse=True,
        ),
    }
