"""Auth dependencies for protected routes (the NestJS "guard" equivalent)."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import resolve_session
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.session import get_db
from app.lib.plans import normalize_plan_key, plan_for


@dataclass
class AppUser:
    id: str
    email: str
    name: str | None
    plan: str
    message_usage: int
    message_limit: int
    is_admin: bool


DB = Annotated[AsyncSession, Depends(get_db)]


async def current_user(request: Request, db: DB) -> AppUser:
    resolved = await resolve_session(db, request)
    if not resolved:
        raise AppError("Unauthorized", 401)
    _, user = resolved
    s = get_settings()

    # TEST_PRO_EMAILS accounts are pinned to Pro; everyone's limit is kept in
    # step with their plan, so a plan edit can't leave a stale limit behind.
    plan = "pro" if s.is_test_pro_email(user.email) else normalize_plan_key(user.plan)
    limit = (await plan_for(db, plan))["messageLimit"]
    if user.plan != plan or user.message_limit != limit:
        user.plan, user.message_limit = plan, limit
        await db.commit()

    return AppUser(
        id=user.id, email=user.email, name=user.name, plan=plan, message_usage=user.message_usage,
        message_limit=user.message_limit, is_admin=s.is_admin_email(user.email),
    )


async def admin_user(user: Annotated[AppUser, Depends(current_user)]) -> AppUser:
    if not user.is_admin:
        raise AppError("Admin access required", 403)
    return user


CurrentUser = Annotated[AppUser, Depends(current_user)]
AdminUser = Annotated[AppUser, Depends(admin_user)]
