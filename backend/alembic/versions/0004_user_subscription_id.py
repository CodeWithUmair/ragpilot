"""add User.subscriptionId (Lemon Squeezy subscription, for the billing portal)

Revision ID: 0004_user_subscription_id
Revises: 0003_plan_limit
Create Date: 2026-10-01

Idempotent per the 0001 convention.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004_user_subscription_id"
down_revision: str | Sequence[str] | None = "0003_plan_limit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT')


def downgrade() -> None:
    op.execute('ALTER TABLE "User" DROP COLUMN IF EXISTS "subscriptionId"')
