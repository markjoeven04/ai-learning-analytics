from uuid import UUID
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
from backend.models.assessment import GradingPeriod


class GradeSubmissionCreate(BaseModel):
    course_id: UUID
    grading_period: GradingPeriod
    notes: Optional[str] = None


class GradeSubmissionResponse(BaseModel):
    id: UUID
    course_id: UUID
    instructor_id: UUID
    grading_period: str
    status: str
    notes: Optional[str] = None
    submitted_at: Optional[datetime] = None
    posted_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class GradeSubmissionQueueItem(GradeSubmissionResponse):
    """Pending row with what the approver is signing off: course, instructor, the period's results
    and the earlier sign-offs in the chain."""
    course_code: Optional[str] = None
    course_title: Optional[str] = None
    course_academic_period: Optional[str] = None
    instructor_name: Optional[str] = None
    passing_threshold: Optional[float] = None
    students: int = 0
    class_average: Optional[float] = None
    below_passing: int = 0
    assessments: list[dict] = []
    approvals: list[dict] = []
    grades: list[dict] = []  # per student: name, student_number, percent, grade, passed


class GradeSubmissionApprovalCreate(BaseModel):
    feedback: Optional[str] = None


class GradeSubmissionApprovalResponse(BaseModel):
    id: UUID
    submission_id: UUID
    approver_id: UUID
    role: str
    status: str
    feedback: Optional[str] = None
    reviewed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
