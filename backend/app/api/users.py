from fastapi import APIRouter
from sqlalchemy import func, or_, select

from app.api.schemas import AdminUserOut, NameIn, PlanIn, UserBrief
from app.auth.deps import DB, AdminUser, CurrentUser
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Chatbot, User
from app.lib.plans import PLANS, get_plan, normalize_plan_key

router = APIRouter(prefix="/api", tags=["users"])


def brief(user: User) -> dict:
    return UserBrief.model_validate(user).model_dump(by_alias=True, mode="json")


async def _set_plan(db, user_id: str, plan: str) -> tuple[User, dict]:
    if plan not in PLANS:
        raise AppError(f"Invalid plan. Expected one of: {', '.join(PLANS)}", 400)
    user = await db.get(User, user_id)
    if not user:
        raise AppError("User not found", 404)
    details = get_plan(plan)
    user.plan, user.message_limit = plan, details["messageLimit"]
    await db.commit()
    return user, details


@router.get("/users/me")
async def me(user: CurrentUser, db: DB):
    row = await db.get(User, user.id)
    count = await db.scalar(select(func.count()).select_from(Chatbot).where(Chatbot.user_id == user.id))
    return {"user": {
        "id": user.id, "email": user.email, "name": user.name, "plan": user.plan,
        "messageUsage": user.message_usage, "messageLimit": user.message_limit, "chatbotCount": count,
        "isAdmin": user.is_admin, "onboardingCompleted": bool(row and row.onboarding_completed),
        "planDetails": get_plan(user.plan),
    }}


@router.patch("/users/me")
async def update_me(body: NameIn, user: CurrentUser, db: DB):
    row = await db.get(User, user.id)
    if body.name is not None:
        row.name = body.name
        await db.commit()
    return {"user": brief(row)}


@router.post("/users/complete-onboarding")
async def complete_onboarding(user: CurrentUser, db: DB):
    row = await db.get(User, user.id)
    row.onboarding_completed = True
    await db.commit()
    return {"success": True}


@router.get("/plans")
async def plans(_: CurrentUser):
    return {"plans": PLANS}


@router.post("/users/me/plan")
async def update_my_plan(body: PlanIn, user: CurrentUser, db: DB):
    """Dev-only self-serve upgrade (no billing yet)."""
    if get_settings().is_production:
        raise AppError("Self-serve plan changes are disabled in production", 403)
    row, details = await _set_plan(db, user.id, body.plan)
    return {"user": brief(row), "planDetails": details}


# ─── Admin ────────────────────────────────────────────────────────────────────


@router.get("/admin/users")
async def admin_list_users(_: AdminUser, db: DB, search: str = "", page: int = 1, limit: int = 50):
    page, limit = max(page, 1), max(1, min(limit, 100))
    where = or_(User.email.ilike(f"%{search}%"), User.name.ilike(f"%{search}%")) if search.strip() else True
    chatbot_count = (
        select(func.count()).select_from(Chatbot).where(Chatbot.user_id == User.id).correlate(User).scalar_subquery()
    )
    rows = (await db.execute(
        select(User, chatbot_count).where(where).order_by(User.created_at.desc())
        .offset((page - 1) * limit).limit(limit)
    )).all()
    total = await db.scalar(select(func.count()).select_from(User).where(where))
    users = [
        AdminUserOut.model_validate({**brief(u), "plan": normalize_plan_key(u.plan), "createdAt": u.created_at,
                                     "chatbotCount": n}).model_dump(by_alias=True, mode="json")
        for u, n in rows
    ]
    return {"users": users, "total": total, "page": page, "limit": limit}


@router.patch("/admin/users/{user_id}/plan")
async def admin_set_plan(user_id: str, body: PlanIn, _: AdminUser, db: DB):
    row, details = await _set_plan(db, user_id, body.plan)
    return {"user": brief(row), "planDetails": details}


@router.post("/admin/users/{user_id}/reset-usage")
async def admin_reset_usage(user_id: str, _: AdminUser, db: DB):
    row = await db.get(User, user_id)
    if not row:
        raise AppError("User not found", 404)
    row.message_usage = 0
    await db.commit()
    return {"user": {"id": row.id, "email": row.email, "messageUsage": 0, "messageLimit": row.message_limit}}
