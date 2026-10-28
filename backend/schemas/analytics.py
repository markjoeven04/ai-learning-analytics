from typing import List
from uuid import UUID
from pydantic import BaseModel, Field
from backend.models.prediction import RiskLevel


class RiskPredictionResponse(BaseModel):
    student_id_hash: str
    risk_level: RiskLevel
    reason: str = ""  # which rule fired (the engine is deterministic; no confidence score)
    weak_competency_ids: list[str] = []
    model_config = {"from_attributes": True}


class CourseRiskOverview(BaseModel):
    course_id: str
    total_students: int
    at_risk: int
    on_track: int
    excelling: int
    predictions: list[RiskPredictionResponse] = []


class CompetencyScoreItem(BaseModel):
    competency_id: str
    competency_code: str
    topic_name: str
    average_score: float
    is_weak: bool


class PeriodTrendItem(BaseModel):
    period: str
    score: float | None = None
    letter_grade: str | None = None


class RecommendationItem(BaseModel):
    id: str
    title: str
    type: str
    url: str
    description: str | None = None
    file_name: str | None = None
    has_file: bool = False
    instructor_endorsed: bool = False  # accepted or added by the course instructor
    competency_tags: list[str] = []
    relevance_score: float
    personalized_message: str | None = None
    my_feedback: bool | None = None  # the student's own helpful / not-helpful rating


class RecommendationFeedbackIn(BaseModel):
    helpful: bool
    comment: str | None = Field(default=None, max_length=500)
    course_id: str | None = None


class ResourceCreate(BaseModel):
    title: str
    type: str
    url: str
    competency_tags: list[str] = []
    description: str | None = None


class ResourceResponse(BaseModel):
    id: UUID
    title: str
    type: str
    url: str
    competency_tags: list[str] = []
    description: str | None = None
    helpful_count: int = 0
    not_helpful_count: int = 0
    model_config = {"from_attributes": True}


# ── Instructor dashboard ──────────────────────────────────────────────────────

class StudentPerformanceItem(BaseModel):
    student_id_hash: str
    full_name: str
    student_number: str | None
    avg_score: float | None
    weakest_topic: str | None
    risk_level: str
    weak_count: int
    formative_avg: float | None = None
    summative_avg: float | None = None


class CompetencyDistributionItem(BaseModel):
    competency_code: str
    topic_name: str
    class_avg: float
    below_passing_count: int
    total_students: int


class RiskTrendItem(BaseModel):
    period: str
    at_risk: int
    on_track: int
    excelling: int


# ── Admin dashboard ───────────────────────────────────────────────────────────

class EnrollmentTrendItem(BaseModel):
    period: str
    student_count: int
    avg_score: float | None


class SubjectPerformanceItem(BaseModel):
    course_id: str
    course_code: str
    course_title: str
    total_students: int
    failing_count: int
    failure_rate: float
    avg_score: float | None
    formative_avg: float | None = None
    summative_avg: float | None = None


class AuditLogEntry(BaseModel):
    id: str
    action: str
    actor_name: str | None
    target_table: str | None
    extra_data: dict | None
    timestamp: str


class YieldDistribution(BaseModel):
    proficient: int   # mastery >= 85
    developing: int   # 75 <= mastery < 85
    emerging: int     # mastery < 75 (learning gap)
    total: int


class AdminStats(BaseModel):
    total_users: int
    total_students: int
    total_instructors: int
    total_courses: int
    total_syllabi: int
    total_resources: int


class CollegeStats(BaseModel):
    total_instructors: int
    total_courses: int
    total_syllabi: int
    total_students: int


# ── Feature 1: Paginated student list ────────────────────────────────────────

class StudentPerformanceListResponse(BaseModel):
    data: List[StudentPerformanceItem]
    total: int
    page: int
    page_size: int


# ── Feature 2: Topic mastery distribution ─────────────────────────────────────

class TopicMasteryItem(BaseModel):
    competency_code: str
    topic_name: str
    class_avg: float
    b0_60: int      # students scoring 0–59%
    b60_75: int     # students scoring 60–74%
    b75_90: int     # students scoring 75–89%
    b90_100: int    # students scoring 90–100%
    total_students: int


# ── Feature 3: Early warning timeline ─────────────────────────────────────────

class EarlyWarningWeek(BaseModel):
    week_label: str       # e.g. "W1", "W2", etc.
    at_risk: int
    on_track: int
    excelling: int
    total: int
