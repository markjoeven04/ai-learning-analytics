"""Faculty-validated ground truth for AI topic mapping (panel comment 1).

A validation set is a stratified random sample of AI-mapped assessment items. For
each course in the set two or three faculty validators label every sampled item blind
(they never see the AI's answer). The majority label is the ground truth the AI is
scored against; when there is no majority the Program Chair (adjudicator) breaks the tie.
"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.core.database import Base
from backend.core.types import GUID


class MappingValidationSet(Base):
    __tablename__ = "mapping_validation_sets"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    sample_size = Column(Integer, nullable=False)
    seed = Column(Integer, nullable=False)
    review_threshold = Column(Float, nullable=False)   # confidence band boundary at sampling time
    created_by = Column(GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)

    items = relationship("MappingValidationItem", back_populates="set", cascade="all, delete-orphan")
    assignments = relationship("MappingValidationAssignment", back_populates="set", cascade="all, delete-orphan")


class MappingValidationAssignment(Base):
    """Who validates and who adjudicates one course's items in a set."""
    __tablename__ = "mapping_validation_assignments"
    __table_args__ = (UniqueConstraint("set_id", "course_id", name="uq_validation_assignment_course"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    set_id = Column(GUID(), ForeignKey("mapping_validation_sets.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(GUID(), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    validator_a_id = Column(GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    validator_b_id = Column(GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    validator_c_id = Column(GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    adjudicator_id = Column(GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    set = relationship("MappingValidationSet", back_populates="assignments")


class MappingValidationItem(Base):
    """One sampled assessment item, with the AI's answer frozen at sampling time."""
    __tablename__ = "mapping_validation_items"
    __table_args__ = (UniqueConstraint("set_id", "assessment_item_id", name="uq_validation_item"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    set_id = Column(GUID(), ForeignKey("mapping_validation_sets.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(GUID(), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    assessment_item_id = Column(GUID(), ForeignKey("assessment_items.id", ondelete="CASCADE"), nullable=False)
    question_text = Column(Text, nullable=False)
    ai_competency_id = Column(GUID(), ForeignKey("competencies.id", ondelete="SET NULL"), nullable=True)
    ai_confidence = Column(Float, nullable=True)
    confidence_band = Column(String(10), nullable=False)   # "high" | "low"
    position = Column(Integer, nullable=False, default=0)   # labeling order (shuffled)

    set = relationship("MappingValidationSet", back_populates="items")
    labels = relationship("MappingValidationLabel", back_populates="item", cascade="all, delete-orphan")
    adjudication = relationship("MappingValidationAdjudication", back_populates="item", uselist=False,
                                cascade="all, delete-orphan")


class MappingValidationLabel(Base):
    """A validator's blind answer: a competency, or 'no matching competency' (none_fits)."""
    __tablename__ = "mapping_validation_labels"
    __table_args__ = (UniqueConstraint("item_id", "validator_id", name="uq_validation_label"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    item_id = Column(GUID(), ForeignKey("mapping_validation_items.id", ondelete="CASCADE"), nullable=False, index=True)
    validator_id = Column(GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    competency_id = Column(GUID(), ForeignKey("competencies.id", ondelete="SET NULL"), nullable=True)
    none_fits = Column(Boolean, nullable=False, default=False)
    labeled_at = Column(DateTime(timezone=True), server_default=func.now())

    item = relationship("MappingValidationItem", back_populates="labels")


class MappingValidationAdjudication(Base):
    __tablename__ = "mapping_validation_adjudications"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    item_id = Column(GUID(), ForeignKey("mapping_validation_items.id", ondelete="CASCADE"), nullable=False, unique=True)
    adjudicator_id = Column(GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    competency_id = Column(GUID(), ForeignKey("competencies.id", ondelete="SET NULL"), nullable=True)
    none_fits = Column(Boolean, nullable=False, default=False)
    note = Column(Text, nullable=True)
    decided_at = Column(DateTime(timezone=True), server_default=func.now())

    item = relationship("MappingValidationItem", back_populates="adjudication")
