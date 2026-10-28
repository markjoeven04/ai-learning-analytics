from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from backend.core.database import Base
from backend.core.types import GUID


class SyllabusStatus(str, enum.Enum):
    pending = "pending"
    validated = "validated"


class ApprovalStage(str, enum.Enum):
    draft = "draft"
    pending_pd = "pending_pd"
    approved_pd = "approved_pd"
    pending_dean = "pending_dean"
    approved_dean = "approved_dean"
    pending_vp = "pending_vp"
    fully_approved = "fully_approved"
    rejected = "rejected"


class Syllabus(Base):
    __tablename__ = "syllabi"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    course_id = Column(GUID(), ForeignKey("courses.id"), nullable=False)
    file_path = Column(String, nullable=False)
    raw_text = Column(String)
    parsed_json = Column("llm_structured_output", JSON)  # DB column per capstone §3.4
    status = Column(Enum(SyllabusStatus), default=SyllabusStatus.pending)
    approval_stage = Column(Enum(ApprovalStage), default=ApprovalStage.draft, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    validated_at = Column(DateTime(timezone=True))

    course = relationship("Course", back_populates="syllabi")
    competencies = relationship("Competency", back_populates="syllabus", cascade="all, delete-orphan")
    approvals = relationship("SyllabusApproval", back_populates="syllabus", cascade="all, delete-orphan")


class SyllabusApproval(Base):
    __tablename__ = "syllabus_approvals"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    syllabus_id = Column(GUID(), ForeignKey("syllabi.id"), nullable=False)
    approver_id = Column(GUID(), ForeignKey("users.id"), nullable=False)
    role = Column(String, nullable=False)
    status = Column(String, nullable=False)  # "approved" | "rejected"
    feedback = Column(String, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), server_default=func.now())

    syllabus = relationship("Syllabus", back_populates="approvals")
    approver = relationship("User")

    @property
    def approver_name(self):
        return self.approver.full_name if self.approver else None


class Competency(Base):
    __tablename__ = "competencies"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    syllabus_id = Column(GUID(), ForeignKey("syllabi.id"), nullable=False)
    competency_code = Column(String, nullable=False)
    topic_name = Column(String, nullable=False)
    learning_outcomes = Column(JSON)
    bloom_level = Column(String, nullable=True)
    # "syllabus" = extracted from the uploaded syllabus; "faculty" = custom topic tag
    # created during mapping review (capstone §3.6.2).
    source = Column(String, nullable=False, default="syllabus", server_default="syllabus")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    syllabus = relationship("Syllabus", back_populates="competencies")
    assessment_items = relationship(
        "AssessmentItem", back_populates="mapped_competency",
        foreign_keys="AssessmentItem.mapped_competency_id",
    )
    student_scores = relationship("StudentScore", back_populates="competency")
