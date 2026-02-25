"""Initial schema — imports and transactions tables

Revision ID: 0001
Revises:
Create Date: 2026-01-01 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "imports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("file_hash", sa.String(length=64), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_hash"),
    )
    op.create_index("ix_imports_id", "imports", ["id"], unique=False)
    op.create_index("ix_imports_file_hash", "imports", ["file_hash"], unique=True)

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("import_id", sa.Integer(), nullable=False),
        sa.Column("posted_date", sa.String(length=20), nullable=False),
        sa.Column("description_raw", sa.Text(), nullable=False),
        sa.Column("description_norm", sa.Text(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("merchant", sa.String(length=255), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("fingerprint_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["import_id"], ["imports.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fingerprint_hash"),
    )
    op.create_index("ix_transactions_id", "transactions", ["id"], unique=False)
    op.create_index(
        "ix_transactions_fingerprint_hash",
        "transactions",
        ["fingerprint_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_transactions_fingerprint_hash", table_name="transactions")
    op.drop_index("ix_transactions_id", table_name="transactions")
    op.drop_table("transactions")
    op.drop_index("ix_imports_file_hash", table_name="imports")
    op.drop_index("ix_imports_id", table_name="imports")
    op.drop_table("imports")
