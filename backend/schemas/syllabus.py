from uuid import UUID
from typing import Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field, computed_field


class CompetencyCreate(BaseModel):
    competency_code: str
    topic_name: str
    learning_outcomes: list[str] = []


class CustomCompetencyCreate(BaseModel):
    """Faculty-created topic tag added during mapping review (capstone §3.6.2)."""
    topic_name: str = Field(min_length=3, max_length=200)
    competency_code: Optional[str] = Field(default=None, max_length=20)
    learning_outcome: Optional[str] = Field(default=None, max_length=500)


class CompetencyResponse(BaseModel):
    id: UUID
    competency_code: str
    topic_name: str
    learning_outcomes: list[str] = []

    model_config = {"from_attributes": True}


class SyllabusApprovalResponse(BaseModel):
    id: UUID
    syllabus_id: UUID
    approver_id: UUID
    approver_name: Optional[str] = None
    role: str
    status: str
    feedback: Optional[str]
    reviewed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class SyllabusApprovalCreate(BaseModel):
    feedback: Optional[str] = None


class SyllabusResponse(BaseModel):
    id: UUID
    course_id: UUID
    status: str
    approval_stage: str = "draft"
    parsed_json: Any = None
    competencies: list[CompetencyResponse] = []

    model_config = {"from_attributes": True}

    # Capstone §3.4 / ERD field name, exposed alongside the legacy `parsed_json`
    # key so the API contract matches the documented schema (DB column is
    # already `llm_structured_output`).
    @computed_field
    @property
    def llm_structured_output(self) -> Any:
        return self.parsed_json


class PendingSyllabusResponse(SyllabusResponse):
    """An approval-queue item: the syllabus plus what an approver needs to recognise it."""
    course_title: Optional[str] = None
    course_code: Optional[str] = None
    course_academic_period: Optional[str] = None
    instructor_name: Optional[str] = None


class SyllabusWithCourseResponse(BaseModel):
    id: UUID
    course_id: UUID
    status: str
    approval_stage: str = "draft"
    parsed_json: Any = None
    competencies: list[CompetencyResponse] = []
    course_title: Optional[str] = None
    course_code: Optional[str] = None
    course_academic_period: Optional[str] = None


class SyllabusValidateRequest(BaseModel):
    # Optional: after approval the competency list is locked, so this only
    # confirms it. A list that differs from the approved one is refused.
    competencies: Optional[list[CompetencyCreate]] = None


class SyllabusCompetenciesUpdate(BaseModel):
    competencies: list[CompetencyCreate] = Field(min_length=1)
