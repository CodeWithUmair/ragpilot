"""Subscription tiers — the single source of truth for limit enforcement.
Keys are camelCase because the dict is returned to the dashboard as-is."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PlanLimit

PLANS: dict[str, dict[str, Any]] = {
    "free": {
        "key": "free",
        "label": "Free",
        "price": 0,
        "messageLimit": 100,
        "chatbotLimit": 1,
        "pageLimit": 50,
        "features": {
            "crawl": True, "fileUpload": True, "leadCapture": False,
            "googleSheets": False, "proactiveCta": False, "removeBranding": False,
        },
        "featureList": [
            "1 chatbot", "100 messages / month", "Website crawler (50 pages)", "File upload (PDF, DOCX, TXT, CSV)",
        ],
        "description": "Try it out. Best for testing or small personal sites.",
    },
    "pro": {
        "key": "pro",
        "label": "Pro",
        "price": 29,
        "messageLimit": 2000,
        "chatbotLimit": 3,
        "pageLimit": 300,
        "features": {
            "crawl": True, "fileUpload": True, "leadCapture": True,
            "googleSheets": True, "proactiveCta": True, "removeBranding": True,
        },
        "featureList": [
            "3 chatbots", "2,000 messages / month", "Website crawler (300 pages)", "Lead capture → Google Sheets",
            "Proactive CTA bubble", 'Remove "Powered by" branding', "Conversation analytics",
        ],
        "description": "For real businesses capturing leads on their site.",
    },
}

# Legacy keys from the old 4-tier system, so old user rows still resolve.
_LEGACY = {"starter": "free", "growth": "pro", "scale": "pro"}


def normalize_plan_key(plan: str | None) -> str:
    if plan in PLANS:
        return plan  # type: ignore[return-value]
    return _LEGACY.get(plan or "", "free")


def get_plan(plan: str | None) -> dict[str, Any]:
    return PLANS[normalize_plan_key(plan)]


async def plan_for(db: AsyncSession, plan: str | None) -> dict[str, Any]:
    """The plan with any admin-edited limits applied. Every limit check goes
    through this (not get_plan) so an admin change takes effect immediately."""
    base = get_plan(plan)
    row = await db.get(PlanLimit, base["key"])
    if not row:
        return base
    return {**base, "messageLimit": row.message_limit, "chatbotLimit": row.chatbot_limit,
            "pageLimit": row.page_limit}


async def feature_allowed(db: AsyncSession, plan: str | None, feature: str) -> bool:
    """The one gate for plan-restricted features (keys of PLANS[...]["features"])."""
    return (await plan_for(db, plan))["features"][feature]
