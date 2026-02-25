"""Add categories and rules tables, add category_id FK to transactions

Revision ID: 0003
Revises: 0002
Create Date: 2026-01-03 00:00:00.000000

Note: If you bootstrapped the database via Base.metadata.create_all (the
default on first run) rather than `alembic upgrade head`, these tables already
exist.  Mark prior migrations as applied first:

    alembic stamp 0002
    alembic upgrade head
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(length=100), nullable=False, unique=True),
        sa.Column("color", sa.String(length=7), nullable=False, server_default="#94a3b8"),
        sa.Column("icon", sa.String(length=10), nullable=False, server_default="📌"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "rules",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("pattern", sa.String(length=500), nullable=False),
        sa.Column("match_type", sa.String(length=20), nullable=False, server_default="contains"),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    # SQLite does not support ADD COLUMN with a FOREIGN KEY constraint directly;
    # we add the column and rely on the ORM relationship (FK enforcement is off by default in SQLite).
    op.add_column("transactions", sa.Column("category_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("transactions", "category_id")
    op.drop_table("rules")
    op.drop_table("categories")
