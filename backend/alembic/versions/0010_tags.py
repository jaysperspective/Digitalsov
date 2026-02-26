"""Add tags and transaction_tags tables

Revision ID: 0010
Revises: 0009
Create Date: 2026-02-25

Changes:
  - Creates tags table (id, name UNIQUE, color, created_at)
  - Creates transaction_tags join table with CASCADE deletes
  - Indexes on both FKs for fast lookups
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("color", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
    )
    op.create_index("idx_tags_name", "tags", ["name"], unique=True)

    op.create_table(
        "transaction_tags",
        sa.Column(
            "transaction_id",
            sa.Integer,
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Integer,
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,
        ),
    )
    op.create_index("idx_transaction_tags_tag_id", "transaction_tags", ["tag_id"])
    op.create_index(
        "idx_transaction_tags_transaction_id", "transaction_tags", ["transaction_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_transaction_tags_transaction_id", table_name="transaction_tags")
    op.drop_index("idx_transaction_tags_tag_id", table_name="transaction_tags")
    op.drop_table("transaction_tags")
    op.drop_index("idx_tags_name", table_name="tags")
    op.drop_table("tags")
