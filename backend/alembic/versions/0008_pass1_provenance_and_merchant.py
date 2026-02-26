"""Pass 1 — merchant_canonical, category_source NOT NULL, provenance indexes

Revision ID: 0008
Revises: 0007
Create Date: 2026-02-25 00:00:00.000000

Changes:
  - transactions.merchant_canonical  TEXT nullable  (filled in Pass 3 merchant canonicalization)
  - transactions.category_source     NOT NULL DEFAULT 'uncategorized'
    (backfills existing NULLs before enforcing the constraint)
  - New indexes: idx_transactions_posted_date, idx_transactions_category_id,
                 idx_transactions_merchant_canonical
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add merchant_canonical (nullable — canonicalization deferred to Pass 3)
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("merchant_canonical", sa.String(255), nullable=True))

    # 2. Backfill NULLs in category_source before tightening the constraint
    op.execute(
        "UPDATE transactions SET category_source = 'uncategorized' WHERE category_source IS NULL"
    )

    # 3. Make category_source NOT NULL with a SQL-level default
    #    batch_alter_table recreates the table for SQLite, picking up the new constraint.
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.alter_column(
            "category_source",
            existing_type=sa.String(20),
            nullable=False,
            server_default="'uncategorized'",
        )

    # 4. Performance / provenance indexes
    op.create_index("idx_transactions_posted_date", "transactions", ["posted_date"])
    op.create_index("idx_transactions_category_id", "transactions", ["category_id"])
    op.create_index("idx_transactions_merchant_canonical", "transactions", ["merchant_canonical"])


def downgrade() -> None:
    op.drop_index("idx_transactions_merchant_canonical", table_name="transactions")
    op.drop_index("idx_transactions_category_id", table_name="transactions")
    op.drop_index("idx_transactions_posted_date", table_name="transactions")

    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.alter_column(
            "category_source",
            existing_type=sa.String(20),
            nullable=True,
            server_default=None,
        )
        batch_op.drop_column("merchant_canonical")
