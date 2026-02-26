"""Pass 3 — merchant_aliases table

Revision ID: 0009
Revises: 0008
Create Date: 2026-02-25 00:00:00.000000

Changes:
  - Creates merchant_aliases table with alias → canonical mapping
  - Index on alias column for fast lookups
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "merchant_aliases",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("alias", sa.String(255), nullable=False),
        sa.Column("canonical", sa.String(255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
    )
    op.create_index("idx_merchant_aliases_alias", "merchant_aliases", ["alias"])


def downgrade() -> None:
    op.drop_index("idx_merchant_aliases_alias", table_name="merchant_aliases")
    op.drop_table("merchant_aliases")
