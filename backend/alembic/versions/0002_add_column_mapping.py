"""Add column_mapping JSON field to imports table

Revision ID: 0002
Revises: 0001
Create Date: 2026-01-02 00:00:00.000000

Note: If you bootstrapped the database via Base.metadata.create_all (the
default on first run) rather than `alembic upgrade head`, the column already
exists.  Mark migration 0001 as applied first:

    alembic stamp 0001
    alembic upgrade head
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("imports", sa.Column("column_mapping", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("imports", "column_mapping")
