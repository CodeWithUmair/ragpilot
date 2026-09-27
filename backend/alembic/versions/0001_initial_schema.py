"""initial schema (idempotent port of the Prisma migrations)

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-09-27

This revision reproduces the FINAL schema produced by the Express+Prisma
backend's migrations (backend/prisma/migrations/*), using the exact table,
column, index and constraint names Prisma generated.

It is written as raw, fully idempotent SQL so the same revision is safe on:
  * a fresh, empty Postgres (creates everything), and
  * the existing production Prisma database (every statement is a no-op for
    objects that already exist; nothing is dropped or rewritten, so no data
    is lost). Older Prisma databases that stopped part-way through the
    migration history catch up through the ADD COLUMN IF NOT EXISTS
    statements (embedding, onboardingCompleted, leadConfig, ipAddress).
To adopt an existing Prisma DB, simply run `alembic upgrade head` against it.

HNSW index: Prisma migration 20260513133718_fix_the_edge_cases dropped
"KnowledgeVector_embedding_hnsw_idx" by accident (Prisma cannot represent
pgvector indexes, so `migrate dev` generated a DROP INDEX). Without it every
similarity search is a sequential scan, so this revision recreates it with the
original parameters (m = 16, ef_construction = 64, cosine ops).

Statements are executed one at a time because asyncpg prepared statements
reject multi-statement strings.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_enum(name: str, *values: str) -> str:
    labels = ", ".join(f"'{v}'" for v in values)
    return f"""
DO $$ BEGIN
    CREATE TYPE "{name}" AS ENUM ({labels});
EXCEPTION WHEN duplicate_object THEN null;
END $$;
"""


def _add_fk(table: str, name: str, column: str, ref_table: str, ref_column: str, on_delete: str) -> str:
    return f"""
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{name}') THEN
        ALTER TABLE "{table}" ADD CONSTRAINT "{name}"
            FOREIGN KEY ("{column}") REFERENCES "{ref_table}"("{ref_column}")
            ON DELETE {on_delete} ON UPDATE CASCADE;
    END IF;
END $$;
"""


EXTENSIONS = ["CREATE EXTENSION IF NOT EXISTS vector"]

ENUMS = [
    _create_enum("WidgetTheme", "light", "dark", "auto"),
    _create_enum("ChatbotStatus", "ACTIVE", "TRAINING", "INACTIVE"),
    _create_enum("SessionStatus", "ACTIVE", "CLOSED"),
    _create_enum("LeadStatus", "NEW", "CONTACTED", "ARCHIVED"),
]

TABLES = [
    """
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "messageUsage" INTEGER NOT NULL DEFAULT 0,
    "messageLimit" INTEGER NOT NULL DEFAULT 100,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
)
""",
    """
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
)
""",
    """
CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
)
""",
    # Not mapped in app/db/models.py, but part of the Prisma schema; kept so a
    # fresh DB matches production exactly.
    """
CREATE TABLE IF NOT EXISTS "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
)
""",
    """
CREATE TABLE IF NOT EXISTS "Chatbot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "embedToken" TEXT NOT NULL,
    "status" "ChatbotStatus" NOT NULL DEFAULT 'ACTIVE',
    "isTrained" BOOLEAN NOT NULL DEFAULT false,
    "lastTrainedAt" TIMESTAMP(3),
    "systemPrompt" TEXT,
    "personalityType" TEXT DEFAULT 'general',
    "welcomeMessage" TEXT,
    "themeColor" TEXT,
    "userId" TEXT NOT NULL,
    "widgetTheme" "WidgetTheme" NOT NULL DEFAULT 'auto',
    "widgetWidth" INTEGER NOT NULL DEFAULT 380,
    "widgetHeight" INTEGER NOT NULL DEFAULT 580,
    "logoUrl" TEXT,
    "primaryColor" TEXT DEFAULT '#6B46C1',
    "headerColor" TEXT,
    "botAvatar" TEXT,
    "inputPlaceholder" TEXT DEFAULT 'Ask a question...',
    "showPoweredBy" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadConfig" JSONB,
    CONSTRAINT "Chatbot_pkey" PRIMARY KEY ("id")
)
""",
    """
CREATE TABLE IF NOT EXISTS "ChatbotCategory" (
    "id" TEXT NOT NULL,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "indexed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChatbotCategory_pkey" PRIMARY KEY ("id")
)
""",
    """
CREATE TABLE IF NOT EXISTS "ChatSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "chatbotId" TEXT,
    "chatbotUrl" TEXT,
    "chatbotToken" TEXT,
    "hostPageUrl" TEXT,
    "visitorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUserMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstQuestion" TEXT,
    "ipAddress" TEXT,
    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
)
""",
    """
CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
)
""",
    """
CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL,
    "chatbotId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "sessionId" TEXT,
    "visitorId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "message" TEXT,
    "fields" JSONB,
    "source" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
)
""",
    """
CREATE TABLE IF NOT EXISTS "KnowledgeVector" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sectionType" TEXT,
    "headingPath" TEXT,
    "source" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1024),
    CONSTRAINT "KnowledgeVector_pkey" PRIMARY KEY ("id")
)
""",
    # Not mapped in app/db/models.py, but part of the Prisma schema.
    """
CREATE TABLE IF NOT EXISTS "ShopifyStore" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "scope" TEXT,
    "userId" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopifyStore_pkey" PRIMARY KEY ("id")
)
""",
]

# Columns added by later Prisma migrations: lets a DB created from an older
# Prisma migration state catch up. No-ops on a fresh DB / current production.
CATCH_UP_COLUMNS = [
    # 20260513120000_rag_fixes
    'ALTER TABLE "KnowledgeVector" ADD COLUMN IF NOT EXISTS "embedding" vector(1024)',
    # 20260513150000_add_onboarding_completed
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false',
    # 20260611120000_lead_capture
    'ALTER TABLE "Chatbot" ADD COLUMN IF NOT EXISTS "leadConfig" JSONB',
    # 20260615120000_chat_session_ip
    'ALTER TABLE "ChatSession" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT',
]

INDEXES = [
    'CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")',
    'CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token")',
    'CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId")',
    'CREATE INDEX IF NOT EXISTS "Session_token_idx" ON "Session"("token")',
    'CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account"("userId")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "Account_providerId_accountId_key" ON "Account"("providerId", "accountId")',
    'CREATE INDEX IF NOT EXISTS "Verification_identifier_idx" ON "Verification"("identifier")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "Chatbot_embedToken_key" ON "Chatbot"("embedToken")',
    'CREATE INDEX IF NOT EXISTS "Chatbot_userId_idx" ON "Chatbot"("userId")',
    'CREATE INDEX IF NOT EXISTS "Chatbot_embedToken_idx" ON "Chatbot"("embedToken")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "Chatbot_url_userId_key" ON "Chatbot"("url", "userId")',
    'CREATE INDEX IF NOT EXISTS "ChatbotCategory_chatbotId_idx" ON "ChatbotCategory"("chatbotId")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "ChatbotCategory_chatbotId_name_key" ON "ChatbotCategory"("chatbotId", "name")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "ChatSession_sessionId_key" ON "ChatSession"("sessionId")',
    'CREATE INDEX IF NOT EXISTS "ChatSession_namespace_idx" ON "ChatSession"("namespace")',
    'CREATE INDEX IF NOT EXISTS "ChatSession_chatbotId_idx" ON "ChatSession"("chatbotId")',
    'CREATE INDEX IF NOT EXISTS "ChatSession_visitorId_idx" ON "ChatSession"("visitorId")',
    'CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId")',
    'CREATE INDEX IF NOT EXISTS "ChatMessage_namespace_createdAt_idx" ON "ChatMessage"("namespace", "createdAt" DESC)',
    'CREATE INDEX IF NOT EXISTS "Lead_chatbotId_idx" ON "Lead"("chatbotId")',
    'CREATE INDEX IF NOT EXISTS "Lead_namespace_idx" ON "Lead"("namespace")',
    'CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead"("createdAt" DESC)',
    'CREATE INDEX IF NOT EXISTS "KnowledgeVector_namespace_idx" ON "KnowledgeVector"("namespace")',
    'CREATE INDEX IF NOT EXISTS "KnowledgeVector_type_idx" ON "KnowledgeVector"("type")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeVector_namespace_contentHash_key" '
    'ON "KnowledgeVector"("namespace", "contentHash")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "ShopifyStore_shop_key" ON "ShopifyStore"("shop")',
    'CREATE INDEX IF NOT EXISTS "ShopifyStore_userId_idx" ON "ShopifyStore"("userId")',
    # Recreated: dropped by accident in Prisma migration 20260513133718.
    'CREATE INDEX IF NOT EXISTS "KnowledgeVector_embedding_hnsw_idx" ON "KnowledgeVector" '
    "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)",
]

FOREIGN_KEYS = [
    _add_fk("Session", "Session_userId_fkey", "userId", "User", "id", "CASCADE"),
    _add_fk("Account", "Account_userId_fkey", "userId", "User", "id", "CASCADE"),
    _add_fk("Chatbot", "Chatbot_userId_fkey", "userId", "User", "id", "CASCADE"),
    _add_fk("ChatbotCategory", "ChatbotCategory_chatbotId_fkey", "chatbotId", "Chatbot", "id", "CASCADE"),
    _add_fk("ChatSession", "ChatSession_chatbotId_fkey", "chatbotId", "Chatbot", "id", "SET NULL"),
    _add_fk("ChatMessage", "ChatMessage_sessionId_fkey", "sessionId", "ChatSession", "sessionId", "CASCADE"),
    _add_fk("Lead", "Lead_chatbotId_fkey", "chatbotId", "Chatbot", "id", "CASCADE"),
]

UPGRADE_STATEMENTS = [*EXTENSIONS, *ENUMS, *TABLES, *CATCH_UP_COLUMNS, *INDEXES, *FOREIGN_KEYS]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    # WARNING: DESTRUCTIVE. This drops every application table (and all data in
    # them) plus the enum types. Never run it against production. The pgvector
    # extension is left installed.
    for table in (
        "Lead",
        "ChatMessage",
        "ChatSession",
        "ChatbotCategory",
        "KnowledgeVector",
        "Chatbot",
        "Account",
        "Session",
        "Verification",
        "ShopifyStore",
        "User",
    ):
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')
    for enum in ("LeadStatus", "SessionStatus", "ChatbotStatus", "WidgetTheme"):
        op.execute(f'DROP TYPE IF EXISTS "{enum}"')
