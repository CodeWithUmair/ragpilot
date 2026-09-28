"""add Lead.priority (COLD/WARM/HOT lead tiering)

Revision ID: 0002_lead_priority
Revises: 0001_initial_schema
Create Date: 2026-09-28

Phase 1 of docs/AGENT_VISION.md: a priority tier is orthogonal to
Lead.status (status is workflow — has the owner followed up; priority is how
promising the lead looks). Idempotent per the 0001 convention so it is safe
to run again and safe against a DB that already has it.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002_lead_priority"
down_revision: str | Sequence[str] | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CREATE_ENUM = """
DO $$ BEGIN
    CREATE TYPE "LeadPriority" AS ENUM ('COLD', 'WARM', 'HOT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
"""

_ADD_COLUMN = """
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "priority" "LeadPriority" NOT NULL DEFAULT 'COLD';
"""

_INDEX = 'CREATE INDEX IF NOT EXISTS "Lead_priority_idx" ON "Lead"("priority")'


def upgrade() -> None:
    op.execute(_CREATE_ENUM)
    op.execute(_ADD_COLUMN)
    op.execute(_INDEX)


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS "Lead_priority_idx"')
    op.execute('ALTER TABLE "Lead" DROP COLUMN IF EXISTS "priority"')
    op.execute('DROP TYPE IF EXISTS "LeadPriority"')
