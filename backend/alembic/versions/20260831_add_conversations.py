"""Add persisted chat conversations."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260831_add_conversations"
down_revision = "20250310_add_owner_payload"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    if sa.inspect(conn).has_table("conversations"):
        return

    op.create_table(
        "conversations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column(
            "messages",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_conversations_owner_updated",
        "conversations",
        ["owner_id", "updated_at"],
    )


def downgrade():
    conn = op.get_bind()
    if sa.inspect(conn).has_table("conversations"):
        op.drop_index("ix_conversations_owner_updated", table_name="conversations")
        op.drop_table("conversations")
