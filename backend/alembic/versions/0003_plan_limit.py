"""add PlanLimit (admin-editable per-plan limits)

Revision ID: 0003_plan_limit
Revises: 0002_lead_priority
Create Date: 2026-10-01

A missing row means the plan's defaults in app/lib/plans.py, so the table
starts empty. Idempotent per the 0001 convention.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003_plan_limit"
down_revision: str | Sequence[str] | None = "0002_lead_priority"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CREATE = """
CREATE TABLE IF NOT EXISTS "PlanLimit" (
    "plan" TEXT PRIMARY KEY,
    "messageLimit" INTEGER NOT NULL,
    "chatbotLimit" INTEGER NOT NULL,
    "pageLimit" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""


def upgrade() -> None:
    op.execute(_CREATE)


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "PlanLimit"')
