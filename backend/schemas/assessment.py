from uuid import UUID
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, computed_field
from backend.models.assessment import AssessmentType, GradingPeriod


class AssessmentCreate(BaseModel):
    title: str
    type: AssessmentType
    grading_period: GradingPeriod
    assessment_category: Optional[str] = None
    date: datetime | None = None


class AssessmentItemResponse(BaseModel):
    id: UUID
    question_text: str
    mapped_competency_id: UUID | None = None
    confidence_score: float | None = None
    needs_review: bool = False
    bloom_level: Optional[str] = None

    model_config = {"from_attributes": True}

    # Capstone §3.4 / ERD field names, exposed alongside the legacy keys so the
    # API contract matches the documented schema. (DB columns are already
    # `mapping_confidence` / `requires_review`; the ORM keeps the legacy attrs.)
    @computed_field
    @property
    def mapping_confidence(self) -> float | None:
        return self.confidence_score

    @computed_field
    @property
    def requires_review(self) -> bool:
        return self.needs_review


class AssessmentResponse(BaseModel):
    id: UUID
    course_id: UUID
    title: str
    type: str
    grading_period: str
    assessment_category: Optional[str] = None
    approval_status: str = "draft"
    date: datetime | None = None

    model_config = {"from_attributes": True}


class AssessmentQueueItem(AssessmentResponse):
    """Pending-approval row: names the course and instructor so the reviewer sees what they approve."""
    course_code: Optional[str] = None
    course_title: Optional[str] = None
    course_academic_period: Optional[str] = None
    instructor_name: Optional[str] = None


class AssessmentApprovalCreate(BaseModel):
    feedback: Optional[str] = None
    content_validity: bool = False
    difficulty_appropriate: bool = False
    instructions_clear: bool = False
    bias_free: bool = False
    outcomes_covered: bool = False


class AssessmentApprovalResponse(BaseModel):
    id: UUID
    assessment_id: UUID
    approver_id: UUID
    role: str
    status: str
    feedback: Optional[str] = None
    content_validity: bool = False
    difficulty_appropriate: bool = False
    instructions_clear: bool = False
    bias_free: bool = False
    outcomes_covered: bool = False
    reviewed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UploadSummary(BaseModel):
    total_rows: int
    valid_rows: int
    items_created: int        # new distinct questions created by this upload
    questions: int = 0        # distinct questions in this upload (new + reused)
    pre_tagged: int = 0       # questions mapped directly via the CSV competency_code column
    flagged_for_review: int   # questions with no mapping yet (sent to topic mapping)
