"""Replace amount (FLOAT) with amount_cents (INTEGER) on transactions table

Revision ID: 0005
Revises: 0004
Create Date: 2026-02-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add nullable column first (NOT NULL would fail on existing rows)
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("amount_cents", sa.Integer(), nullable=True))

    # 2. Populate from existing float data
    op.execute(
        "UPDATE transactions SET amount_cents = CAST(ROUND(amount * 100) AS INTEGER)"
    )

    # 3. Enforce NOT NULL, drop the float column
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.alter_column("amount_cents", existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column("amount")


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("amount", sa.Float(), nullable=True))
    op.execute("UPDATE transactions SET amount = amount_cents / 100.0")
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.alter_column("amount", existing_type=sa.Float(), nullable=False)
        batch_op.drop_column("amount_cents")
