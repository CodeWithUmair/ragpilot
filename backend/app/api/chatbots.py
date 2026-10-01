from urllib.parse import urlparse

from fastapi import APIRouter
from sqlalchemy import delete, func, select

from app.api.schemas import CategoriesIn, ChatbotCreate, ChatbotOut, ChatbotUpdate, PublicChatbotOut
from app.auth.deps import DB, CurrentUser
from app.core.errors import AppError
from app.db.models import Chatbot, ChatbotCategory
from app.lib.embed_token import generate_embed_token
from app.lib.lead_config import public_lead_config
from app.lib.plans import plan_for
from app.rag.vector_store import PgVectorStore

router = APIRouter(prefix="/api", tags=["chatbots"])


def name_from_url(url: str) -> str:
    host = (urlparse(url).hostname or "").removeprefix("www.")
    first = host.split(".")[0] if host else ""
    return " ".join(w[:1].upper() + w[1:] for w in first.split("-")) or "My Chatbot"


async def owned_chatbot(db, user_id: str, chatbot_id: str) -> Chatbot:
    bot = await db.scalar(select(Chatbot).where(Chatbot.id == chatbot_id, Chatbot.user_id == user_id))
    if not bot:
        raise AppError("Chatbot not found", 404)
    return bot


def out(bot: Chatbot) -> dict:
    return ChatbotOut.model_validate(bot).model_dump(by_alias=True, mode="json")


@router.get("/chatbots")
async def list_chatbots(user: CurrentUser, db: DB):
    bots = (await db.scalars(
        select(Chatbot).where(Chatbot.user_id == user.id).order_by(Chatbot.created_at.desc())
    )).all()
    return {"chatbots": [out(b) for b in bots]}


@router.get("/chatbots/{chatbot_id}")
async def get_chatbot(chatbot_id: str, user: CurrentUser, db: DB):
    bot = await owned_chatbot(db, user.id, chatbot_id)
    return {"chatbot": out(bot), "vectorCount": await PgVectorStore(db).count(bot.embed_token)}


@router.post("/chatbots", status_code=201)
async def create_chatbot(body: ChatbotCreate, user: CurrentUser, db: DB):
    if not body.url.startswith("http"):
        raise AppError("Valid URL is required", 400)

    bot = await db.scalar(select(Chatbot).where(Chatbot.url == body.url, Chatbot.user_id == user.id))
    if bot:  # re-saving an existing (url, user) just touches it
        await db.commit()
        return {"chatbot": out(bot), "embedToken": bot.embed_token}

    plan = await plan_for(db, user.plan)
    count = await db.scalar(select(func.count()).select_from(Chatbot).where(Chatbot.user_id == user.id))
    if count >= plan["chatbotLimit"]:
        limit = plan["chatbotLimit"]
        raise AppError(
            f"Your {plan['label']} plan allows {limit} chatbot{'' if limit == 1 else 's'}. Upgrade to add more.", 402
        )

    fields = body.model_dump(exclude_unset=True, exclude={"url", "name"})
    bot = Chatbot(
        url=body.url, user_id=user.id, embed_token=generate_embed_token(),
        name=(body.name or "").strip() or name_from_url(body.url), **fields,
    )
    db.add(bot)
    await db.commit()
    await db.refresh(bot, ["categories"])
    return {"chatbot": out(bot), "embedToken": bot.embed_token}


@router.patch("/chatbots/{chatbot_id}")
async def update_chatbot(chatbot_id: str, body: ChatbotUpdate, user: CurrentUser, db: DB):
    bot = await owned_chatbot(db, user.id, chatbot_id)
    changes = body.model_dump(exclude_unset=True)
    # Empty name/status are ignored rather than blanking the field.
    for key in ("name", "status"):
        if not changes.get(key):
            changes.pop(key, None)
    for key, value in changes.items():
        setattr(bot, key, value)
    await db.commit()
    await db.refresh(bot)
    return {"chatbot": out(bot)}


@router.delete("/chatbots/{chatbot_id}")
async def delete_chatbot(chatbot_id: str, user: CurrentUser, db: DB):
    bot = await owned_chatbot(db, user.id, chatbot_id)
    await PgVectorStore(db).delete_namespace(bot.embed_token)
    await db.delete(bot)
    await db.commit()
    return {"success": True}


@router.post("/chatbots/{chatbot_id}/categories")
async def save_categories(chatbot_id: str, body: CategoriesIn, user: CurrentUser, db: DB):
    bot = await owned_chatbot(db, user.id, chatbot_id)
    await db.execute(delete(ChatbotCategory).where(ChatbotCategory.chatbot_id == bot.id))
    db.add_all(ChatbotCategory(chatbot_id=bot.id, **c.model_dump()) for c in body.categories)
    if body.is_trained is not None:
        bot.is_trained = body.is_trained
    if body.last_trained_at:
        bot.last_trained_at = body.last_trained_at
    await db.commit()  # one transaction: categories swap + trained flag
    await db.refresh(bot)
    await db.refresh(bot, ["categories"])
    return {"chatbot": out(bot)}


@router.post("/chatbots/{chatbot_id}/reset-knowledge")
async def reset_knowledge(chatbot_id: str, user: CurrentUser, db: DB):
    bot = await owned_chatbot(db, user.id, chatbot_id)
    await PgVectorStore(db).delete_namespace(bot.embed_token)
    bot.is_trained, bot.last_trained_at = False, None
    await db.commit()
    return {"success": True}


@router.get("/chatbots/public/{embed_token}")
async def public_chatbot(embed_token: str, db: DB):
    """Widget bootstrap (theme, welcome message, public lead-form config)."""
    bot = await db.scalar(select(Chatbot).where(Chatbot.embed_token == embed_token))
    if not bot:
        raise AppError("Chatbot not found", 404)
    data = PublicChatbotOut.model_validate(
        {**{k: getattr(bot, k) for k in PublicChatbotOut.model_fields if k != "lead_config"},
         "lead_config": public_lead_config(bot.lead_config)}
    )
    return {"chatbot": data.model_dump(by_alias=True, mode="json")}
