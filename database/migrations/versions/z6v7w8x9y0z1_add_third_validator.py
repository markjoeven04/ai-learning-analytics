"""mapping validation: third validator for majority-vote ground truth

Revision ID: z6v7w8x9y0z1
Revises: y5u6v7w8x9y0
Create Date: 2026-10-28

Three faculty experts label each sampled item; the majority label is the ground
truth and the Program Chair breaks ties.
"""
from alembic import op
import sqlalchemy as sa
import backend.core.types

revision = 'z6v7w8x9y0z1'
down_revision = 'y5u6v7w8x9y0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('mapping_validation_assignments',
                  sa.Column('validator_c_id', backend.core.types.GUID(),
                            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))


def downgrade():
    op.drop_column('mapping_validation_assignments', 'validator_c_id')
