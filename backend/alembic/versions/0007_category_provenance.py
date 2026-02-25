"""Add category_source and category_rule_id to transactions

Revision ID: 0007
Revises: 0006
Create Date: 2026-02-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("category_source", sa.String(20), nullable=True))
        batch_op.add_column(sa.Column("category_rule_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_column("category_rule_id")
        batch_op.drop_column("category_source")
