import csv
import io
import uuid
from collections import defaultdict
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.deps import get_current_user, require_role, require_consent
from backend.core.security import hash_student_id
from backend.models.user import User, UserRole
from backend.models.course import Course
from backend.models.prediction import RiskLevel
from backend.models.resource import Resource
from backend.models.recommendation_feedback import RecommendationFeedback
from backend.models.score import StudentScore
from backend.models.assessment import Assessment, AssessmentItem, GradingPeriod
from backend.schemas.analytics import (
    RiskPredictionResponse, CourseRiskOverview,
    RecommendationItem, RecommendationFeedbackIn, ResourceCreate, ResourceResponse,
    CompetencyScoreItem, AdminStats, CollegeStats, PeriodTrendItem,
    StudentPerformanceItem, CompetencyDistributionItem, RiskTrendItem,
    EnrollmentTrendItem, SubjectPerformanceItem, AuditLogEntry, YieldDistribution,
    StudentPerformanceListResponse, TopicMasteryItem, EarlyWarningWeek,
)
from backend.services.ai.risk_predictor import predict_risk
from backend.services.ai.recommender import get_recommendations
from backend.services.ai.feature_engineering import (
    get_all_students_in_course, build_student_features, competency_mastery_score,
)
from backend.services.grading import get_letter_grade
from backend.models.instructor_intervention import InstructorIntervention
from backend.models.attendance import AttendanceRecord, AttendanceStatus
from backend.models.grade_consultation import GradeConsultation, AcademicStatus
from backend.models.academic_standing import AcademicStanding, AcademicStandingLevel
from backend.schemas.instructor_intervention import InterventionCreate, InterventionOut, InterventionStatusUpdate
from backend.schemas.grade_consultation import GradeConsultationCreate, GradeConsultationResponse
from backend.services.academic_standing import upsert_academic_standing

from backend.services.institution_settings import get_settings

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _course_read(course_id, db: Session, current_user: User) -> Course:
    """404 for an unknown course; 403 unless the viewer owns it, administers it, or is
    the Program Director / Dean of its college (or the VP)."""
    from backend.core.access import assert_course_read_access
    try:
        course = db.query(Course).filter(Course.id == uuid.UUID(str(course_id))).first()
    except ValueError:
        course = None
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    assert_course_read_access(course.instructor_id, current_user, db)
    return course

_PERIODS_ORDERED = [
    ("Prelim", GradingPeriod.prelim),
    ("Midterm", GradingPeriod.midterm),
    ("Semi-Final", GradingPeriod.semi_final),
    ("Final", GradingPeriod.final),
]


def _assessment_ids(course_id: str, db: Session) -> list[str]:
    return [str(a.id) for a in db.query(Assessment).filter(Assessment.course_id == course_id).all()]


def _student_period_buckets(assessment_ids: list[str], db: Session):
    scores = db.query(StudentScore).filter(
        StudentScore.assessment_id.in_(assessment_ids)
    ).all()
    period_student: dict = defaultdict(lambda: defaultdict(list))
    for s in scores:
        pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
        period_student[s.grading_period][s.student_id_hash].append(pct)
    return period_student


# ── Student self-service ──────────────────────────────────────────────────────

@router.get("/me/courses")
def get_my_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        return []
    sid_hash = hash_student_id(current_user.student_number)
    rows = (
        db.query(Course)
        .join(Assessment, Assessment.course_id == Course.id)
        .join(StudentScore, StudentScore.assessment_id == Assessment.id)
        .filter(StudentScore.student_id_hash == sid_hash)
        .distinct()
        .all()
    )
    return [
        {
            "id": str(c.id),
            "title": c.title,
            "code": c.code,
            "academic_period": c.academic_period,
            "instructor_name": c.instructor.full_name if c.instructor else None,
        }
        for c in rows
    ]


@router.get("/me/risk")
def get_my_risk(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        raise HTTPException(status_code=400, detail="No student number on file")
    sid_hash = hash_student_id(current_user.student_number)
    result = predict_risk(sid_hash, course_id, db)
    return {
        "risk_level": result["risk_level"],
        "reason": result["reason"],
        "weak_competency_ids": result["weak_competency_ids"],
    }


@router.get("/me/competency-scores", response_model=list[CompetencyScoreItem])
def get_my_competency_scores(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        return []
    sid_hash = hash_student_id(current_user.student_number)
    features = build_student_features(sid_hash, course_id, db)
    if not features:
        return []

    from backend.models.syllabus import Competency
    results = []
    for cid, avg in features["competency_avgs"].items():
        comp = db.query(Competency).filter(Competency.id == cid).first()
        if comp:
            results.append(CompetencyScoreItem(
                competency_id=cid,
                competency_code=comp.competency_code,
                topic_name=comp.topic_name,
                average_score=round(avg, 2),
                is_weak=avg < get_settings(db).mastery_threshold,
            ))
    return results


@router.get("/me/trend", response_model=list[PeriodTrendItem])
def get_my_trend(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        return []
    sid_hash = hash_student_id(current_user.student_number)
    a_ids = _assessment_ids(course_id, db)
    if not a_ids:
        return []

    scores = db.query(StudentScore).filter(
        StudentScore.student_id_hash == sid_hash,
        StudentScore.assessment_id.in_(a_ids),
    ).all()

    buckets: dict = defaultdict(list)
    for s in scores:
        pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
        buckets[s.grading_period].append(pct)

    period_avgs = {p: sum(v) / len(v) for p, v in buckets.items()}
    return [
        PeriodTrendItem(
            period=label,
            score=round(period_avgs[gp], 2) if gp in period_avgs else None,
            letter_grade=get_letter_grade(period_avgs[gp], db) if gp in period_avgs else None,
        )
        for label, gp in _PERIODS_ORDERED
    ]


@router.get("/me/recommendations", response_model=list[RecommendationItem])
def get_my_recommendations(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        return []
    sid_hash = hash_student_id(current_user.student_number)
    result = predict_risk(sid_hash, course_id, db)
    recs = get_recommendations(result["weak_competency_ids"], course_id, db)
    if recs:
        rated = {
            str(f.resource_id): f.helpful
            for f in db.query(RecommendationFeedback).filter(RecommendationFeedback.student_id_hash == sid_hash).all()
        }
        for r in recs:
            r["my_feedback"] = rated.get(r["id"])
    return recs


@router.post("/me/recommendations/{resource_id}/feedback", status_code=200)
def rate_recommendation(
    resource_id: uuid.UUID,
    payload: RecommendationFeedbackIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    """Student rates a recommended resource as helpful or not (capstone §2.3 Feedback
    Loop). Re-rating the same resource updates the earlier rating."""
    if not current_user.student_number:
        raise HTTPException(status_code=400, detail="Student number not set on this account")
    if not db.query(Resource).filter(Resource.id == resource_id).first():
        raise HTTPException(status_code=404, detail="Resource not found")
    course_id = None
    if payload.course_id:
        try:
            course_id = uuid.UUID(payload.course_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid course_id")

    sid_hash = hash_student_id(current_user.student_number)
    fb = db.query(RecommendationFeedback).filter(
        RecommendationFeedback.student_id_hash == sid_hash,
        RecommendationFeedback.resource_id == resource_id,
    ).first()
    if fb is None:
        fb = RecommendationFeedback(student_id_hash=sid_hash, resource_id=resource_id)
        db.add(fb)
    fb.helpful = payload.helpful
    fb.comment = (payload.comment or "").strip() or None
    fb.course_id = course_id
    db.commit()
    return {"resource_id": str(resource_id), "helpful": fb.helpful}


# ── Instructor course analytics ───────────────────────────────────────────────

@router.get("/courses/{course_id}/overview", response_model=CourseRiskOverview)
def get_course_overview(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _course_read(course_id, db, current_user)
    student_ids = get_all_students_in_course(course_id, db)
    predictions = []
    counts = {RiskLevel.at_risk: 0, RiskLevel.on_track: 0, RiskLevel.excelling: 0}

    for sid in student_ids:
        result = predict_risk(sid, course_id, db)
        level = result["risk_level"]
        counts[level] += 1
        predictions.append(RiskPredictionResponse(
            student_id_hash=sid,
            risk_level=level,
            reason=result["reason"],
            weak_competency_ids=result["weak_competency_ids"],
        ))

    return CourseRiskOverview(
        course_id=course_id,
        total_students=len(student_ids),
        at_risk=counts[RiskLevel.at_risk],
        on_track=counts[RiskLevel.on_track],
        excelling=counts[RiskLevel.excelling],
        predictions=predictions,
    )


@router.get("/courses/{course_id}/students", response_model=StudentPerformanceListResponse)
def get_course_students(
    course_id: str,
    sort_by: str = Query("avg_score", description="Field to sort by: avg_score, risk_level, weak_count, full_name"),
    sort_order: str = Query("asc", description="Sort direction: asc or desc"),
    risk_filter: str = Query("all", description="Filter by risk level: all, At-Risk, On-Track, Excelling"),
    search: str = Query("", description="Partial match on full_name or student_number"),
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(10, ge=1, le=2000, description="Page size (max 2000)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _course_read(course_id, db, current_user)
    from backend.models.syllabus import Competency

    student_hashes = get_all_students_in_course(course_id, db)
    if not student_hashes:
        return StudentPerformanceListResponse(data=[], total=0, page=1, page_size=limit)

    all_students = db.query(User).filter(
        User.role == UserRole.student,
        User.student_number.isnot(None),
    ).all()
    hash_to_user = {hash_student_id(s.student_number): s for s in all_students}

    results = []
    for sid_hash in student_hashes:
        user = hash_to_user.get(sid_hash)
        features = build_student_features(sid_hash, course_id, db)
        risk_result = predict_risk(sid_hash, course_id, db)

        avg = features["avg_score"] if features else None
        weak_ids = risk_result.get("weak_competency_ids", [])
        risk_level_val = risk_result["risk_level"]

        # Normalise RiskLevel enum or string to display string
        if hasattr(risk_level_val, "value"):
            risk_str = risk_level_val.value
        else:
            risk_str = str(risk_level_val)

        weakest_topic = None
        if features and features.get("competency_avgs"):
            worst_cid = min(features["competency_avgs"], key=lambda c: features["competency_avgs"][c])
            comp = db.query(Competency).filter(Competency.id == worst_cid).first()
            if comp:
                weakest_topic = comp.topic_name

        full_name = user.full_name if user else f"Student {sid_hash[:8]}…"
        student_number = user.student_number if user else None

        results.append(StudentPerformanceItem(
            student_id_hash=sid_hash,
            full_name=full_name,
            student_number=student_number,
            avg_score=round(avg, 1) if avg is not None else None,
            weakest_topic=weakest_topic,
            risk_level=risk_str,
            weak_count=len(weak_ids),
            formative_avg=round(features["formative_avg"], 1) if features and features.get("formative_avg") is not None else None,
            summative_avg=round(features["summative_avg"], 1) if features and features.get("summative_avg") is not None else None,
        ))

    # ── Apply filters ─────────────────────────────────────────────────────────

    # 1. risk_filter
    if risk_filter != "all":
        results = [r for r in results if r.risk_level.lower() == risk_filter.lower()]

    # 2. search (partial match on full_name or student_number)
    if search:
        search_lower = search.lower()
        results = [
            r for r in results
            if search_lower in r.full_name.lower()
            or (r.student_number and search_lower in r.student_number.lower())
        ]

    # 3. sort
    _SORT_FIELDS = {"avg_score", "risk_level", "weak_count", "full_name"}
    sort_field = sort_by if sort_by in _SORT_FIELDS else "avg_score"
    reverse = sort_order.lower() == "desc"

    def _sort_key(item: StudentPerformanceItem):
        val = getattr(item, sort_field)
        # avg_score is the only nullable sort field; substitute sentinels to push
        # None to the bottom regardless of direction.
        if val is None:
            # For asc: use +inf; for desc (reversed): use -inf so they still end up last
            return float("inf") if not reverse else float("-inf")
        if isinstance(val, (int, float)):
            return val
        return str(val)

    results = sorted(results, key=_sort_key, reverse=reverse)

    # 4. paginate
    total = len(results)
    page = skip // limit + 1
    data = results[skip: skip + limit]

    return StudentPerformanceListResponse(data=data, total=total, page=page, page_size=limit)


@router.get("/courses/{course_id}/export/students")
def export_course_students_csv(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    """Export ALL students for a course as CSV (no pagination)."""
    from backend.models.syllabus import Competency

    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if current_user.role == UserRole.instructor and course.instructor_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your course")

    student_hashes = get_all_students_in_course(course_id, db)
    all_students = db.query(User).filter(
        User.role == UserRole.student,
        User.student_number.isnot(None),
    ).all()
    hash_to_user = {hash_student_id(s.student_number): s for s in all_students}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Student Name", "Student Number", "Avg Score (%)", "Weakest Topic", "Risk Level", "Weak Competencies"])

    for sid_hash in student_hashes:
        user = hash_to_user.get(sid_hash)
        features = build_student_features(sid_hash, course_id, db)
        risk_result = predict_risk(sid_hash, course_id, db)

        avg = features["avg_score"] if features else None
        weak_ids = risk_result.get("weak_competency_ids", [])
        risk_level_val = risk_result["risk_level"]
        risk_str = risk_level_val.value if hasattr(risk_level_val, "value") else str(risk_level_val)

        weakest_topic = ""
        if features and features.get("competency_avgs"):
            worst_cid = min(features["competency_avgs"], key=lambda c: features["competency_avgs"][c])
            comp = db.query(Competency).filter(Competency.id == worst_cid).first()
            if comp:
                weakest_topic = comp.topic_name

        writer.writerow([
            user.full_name if user else f"Student {sid_hash[:8]}",
            user.student_number if user else "",
            round(avg, 1) if avg is not None else "",
            weakest_topic,
            risk_str,
            len(weak_ids),
        ])

    output.seek(0)
    filename = f"{course.code or course_id}_students_performance.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/courses/{course_id}/topic-mastery-distribution", response_model=list[TopicMasteryItem])
def get_topic_mastery_distribution(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    """
    Per-competency histogram of student scores (0-60, 60-75, 75-90, 90-100 buckets).
    Sorted by class_avg ascending (weakest competency first).
    """
    _course_read(course_id, db, current_user)
    from backend.models.syllabus import Competency

    # Verify course exists (implicitly via assessment query)
    a_ids = _assessment_ids(course_id, db)
    if not a_ids:
        return []

    # Collect all competency IDs mapped to this course's assessments via AssessmentItem
    items = (
        db.query(AssessmentItem)
        .filter(
            AssessmentItem.assessment_id.in_(a_ids),
            AssessmentItem.mapped_competency_id.isnot(None),
        )
        .all()
    )
    competency_ids = list({str(item.mapped_competency_id) for item in items})

    if not competency_ids:
        return []

    results = []
    for cid in competency_ids:
        comp = db.query(Competency).filter(Competency.id == cid).first()
        if not comp:
            continue

        # Get all StudentScore rows linked to this competency
        scores = (
            db.query(StudentScore)
            .filter(
                StudentScore.assessment_id.in_(a_ids),
                StudentScore.competency_id == cid,
            )
            .all()
        )

        if not scores:
            continue

        # Compute per-student average (normalized 0–100)
        student_score_map: dict = defaultdict(list)
        for s in scores:
            student_score_map[s.student_id_hash].append(s)

        student_avgs = [competency_mastery_score(v) for v in student_score_map.values()]
        if not student_avgs:
            continue

        class_avg = sum(student_avgs) / len(student_avgs)

        # Histogram bins
        b0_60 = sum(1 for avg in student_avgs if avg < 60)
        b60_75 = sum(1 for avg in student_avgs if 60 <= avg < 75)
        b75_90 = sum(1 for avg in student_avgs if 75 <= avg < 90)
        b90_100 = sum(1 for avg in student_avgs if avg >= 90)

        results.append(TopicMasteryItem(
            competency_code=comp.competency_code,
            topic_name=comp.topic_name,
            class_avg=round(class_avg, 2),
            b0_60=b0_60,
            b60_75=b60_75,
            b75_90=b75_90,
            b90_100=b90_100,
            total_students=len(student_avgs),
        ))

    return sorted(results, key=lambda x: x.class_avg)


@router.get("/courses/{course_id}/competency-distribution", response_model=list[CompetencyDistributionItem])
def get_competency_distribution(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _course_read(course_id, db, current_user)
    from backend.models.syllabus import Competency

    student_hashes = get_all_students_in_course(course_id, db)
    if not student_hashes:
        return []

    comp_score_map: dict = defaultdict(list)
    for sid_hash in student_hashes:
        features = build_student_features(sid_hash, course_id, db)
        if features and features.get("competency_avgs"):
            for cid, avg in features["competency_avgs"].items():
                comp_score_map[cid].append(avg)

    results = []
    for cid, scores in comp_score_map.items():
        comp = db.query(Competency).filter(Competency.id == cid).first()
        if not comp:
            continue
        class_avg = sum(scores) / len(scores)
        below = sum(1 for s in scores if s < get_settings(db).mastery_threshold)
        results.append(CompetencyDistributionItem(
            competency_code=comp.competency_code,
            topic_name=comp.topic_name,
            class_avg=round(class_avg, 2),
            below_passing_count=below,
            total_students=len(scores),
        ))

    return sorted(results, key=lambda x: x.class_avg)


@router.get("/courses/{course_id}/risk-trend", response_model=list[RiskTrendItem])
def get_risk_trend(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _course_read(course_id, db, current_user)
    a_ids = _assessment_ids(course_id, db)
    if not a_ids:
        return []

    period_student = _student_period_buckets(a_ids, db)

    results = []
    for label, gp in _PERIODS_ORDERED:
        student_avgs = period_student.get(gp, {})
        if not student_avgs:
            continue
        at_risk = on_track = excelling = 0
        for scores in student_avgs.values():
            avg = sum(scores) / len(scores)
            if avg < 75:
                at_risk += 1
            elif avg < 90:
                on_track += 1
            else:
                excelling += 1
        results.append(RiskTrendItem(period=label, at_risk=at_risk, on_track=on_track, excelling=excelling))

    return results


@router.get("/courses/{course_id}/early-warning-timeline", response_model=list[EarlyWarningWeek])
def get_early_warning_timeline(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    """
    Weekly (or period-based) snapshots of risk level counts using running cumulative averages.
    Returns W1, W2, … (up to 10 weeks), or P1–P4 grading periods if fewer than 2 weeks of data.
    """
    _course_read(course_id, db, current_user)
    a_ids = _assessment_ids(course_id, db)
    if not a_ids:
        return []

    all_scores = (
        db.query(StudentScore)
        .filter(StudentScore.assessment_id.in_(a_ids))
        .all()
    )
    if not all_scores:
        return []

    # Resolve submission date: use submission_date if set, else fall back to assessment.date
    def _score_date(s: StudentScore):
        if s.submission_date:
            return s.submission_date.replace(tzinfo=None)
        if s.assessment and s.assessment.date:
            return s.assessment.date.replace(tzinfo=None)
        return None

    dated_scores = [(s, _score_date(s)) for s in all_scores]
    valid_dated = [(s, d) for s, d in dated_scores if d is not None]

    if not valid_dated:
        return []

    min_date = min(d for _, d in valid_dated)
    max_date = max(d for _, d in valid_dated)
    total_days = (max_date - min_date).days

    # ── Fallback: fewer than 14 days → use grading period buckets labeled P1–P4 ─
    if total_days < 14:
        period_student = _student_period_buckets(a_ids, db)
        results = []
        for idx, (label, gp) in enumerate(_PERIODS_ORDERED, start=1):
            student_avgs = period_student.get(gp, {})
            if not student_avgs:
                continue
            at_risk = on_track = excelling = 0
            for scores in student_avgs.values():
                avg = sum(scores) / len(scores)
                if avg < 75:
                    at_risk += 1
                elif avg < 90:
                    on_track += 1
                else:
                    excelling += 1
            total = at_risk + on_track + excelling
            if total == 0:
                continue
            results.append(EarlyWarningWeek(
                week_label=f"P{idx}",
                at_risk=at_risk,
                on_track=on_track,
                excelling=excelling,
                total=total,
            ))
        return results

    # ── Weekly mode: split date range into 7-day buckets (cap at 10 weeks) ────
    num_weeks = min((total_days // 7) + 1, 10)

    results = []
    for week_idx in range(num_weeks):
        week_start = min_date + timedelta(days=week_idx * 7)
        week_end = week_start + timedelta(days=7)

        # Cumulative: collect all scores up to end of this week
        cumulative_scores: dict = defaultdict(list)
        for s, d in valid_dated:
            if d < week_end:
                pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
                cumulative_scores[s.student_id_hash].append(pct)

        if not cumulative_scores:
            continue

        at_risk = on_track = excelling = 0
        for score_list in cumulative_scores.values():
            avg = sum(score_list) / len(score_list)
            if avg < 75:
                at_risk += 1
            elif avg < 90:
                on_track += 1
            else:
                excelling += 1

        total = at_risk + on_track + excelling
        if total == 0:
            continue

        results.append(EarlyWarningWeek(
            week_label=f"W{week_idx + 1}",
            at_risk=at_risk,
            on_track=on_track,
            excelling=excelling,
            total=total,
        ))

    return results



# ── Instructor aggregate analytics ───────────────────────────────────────────

@router.get("/instructor/course-summaries", response_model=list[SubjectPerformanceItem])
def get_instructor_course_summaries(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    if current_user.role == UserRole.admin:
        courses = db.query(Course).all()
    else:
        courses = db.query(Course).filter(Course.instructor_id == current_user.id).all()

    results = []
    for course in courses:
        a_map = {str(a.id): a for a in course.assessments}
        a_ids = list(a_map.keys())
        if not a_ids:
            continue
        all_scores = db.query(StudentScore).filter(StudentScore.assessment_id.in_(a_ids)).all()

        student_scores: dict = defaultdict(list)
        formative_scores: list[float] = []
        summative_scores: list[float] = []
        for s in all_scores:
            pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
            student_scores[s.student_id_hash].append(pct)
            a = a_map.get(str(s.assessment_id))
            if a and str(a.assessment_category) == "summative":
                summative_scores.append(pct)
            else:
                formative_scores.append(pct)

        if not student_scores:
            continue

        student_avgs = [sum(v) / len(v) for v in student_scores.values()]
        total = len(student_avgs)
        failing = sum(1 for avg in student_avgs if avg < 75)
        course_avg = sum(student_avgs) / total

        results.append(SubjectPerformanceItem(
            course_id=str(course.id),
            course_code=course.code,
            course_title=course.title,
            total_students=total,
            failing_count=failing,
            failure_rate=round(failing / total * 100, 1),
            avg_score=round(course_avg, 2),
            formative_avg=round(sum(formative_scores) / len(formative_scores), 1) if formative_scores else None,
            summative_avg=round(sum(summative_scores) / len(summative_scores), 1) if summative_scores else None,
        ))

    return sorted(results, key=lambda x: x.failure_rate, reverse=True)


@router.get("/instructor/at-risk-students")
def get_instructor_at_risk(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    from backend.models.syllabus import Competency

    if current_user.role == UserRole.admin:
        courses = db.query(Course).all()
    else:
        courses = db.query(Course).filter(Course.instructor_id == current_user.id).all()

    all_students = db.query(User).filter(
        User.role == UserRole.student,
        User.student_number.isnot(None),
    ).all()
    hash_to_user = {hash_student_id(s.student_number): s for s in all_students}

    from backend.services.early_warning import remind_overdue, timeliness
    course_ids = [c.id for c in courses]
    remind_overdue(course_ids, db)
    timing = {(r["course_id"], r["student_id_hash"]): r for r in timeliness(course_ids, db)["rows"]}

    results = []
    for course in courses:
        student_hashes = get_all_students_in_course(str(course.id), db)
        for sid_hash in student_hashes:
            features = build_student_features(sid_hash, str(course.id), db)
            risk_result = predict_risk(sid_hash, str(course.id), db)
            if risk_result["risk_level"] != RiskLevel.at_risk:
                continue
            t = timing.get((str(course.id), sid_hash), {})

            user = hash_to_user.get(sid_hash)
            avg = features["avg_score"] if features else None

            weakest_topic = None
            if features and features.get("competency_avgs"):
                worst_cid = min(features["competency_avgs"], key=lambda c: features["competency_avgs"][c])
                comp = db.query(Competency).filter(Competency.id == worst_cid).first()
                if comp:
                    weakest_topic = comp.topic_name

            results.append({
                "student_id_hash": sid_hash,
                "full_name": user.full_name if user else f"Student {sid_hash[:8]}",
                "student_number": user.student_number if user else None,
                "course_id": str(course.id),
                "course_code": course.code,
                "course_title": course.title,
                "avg_score": round(avg, 1) if avg is not None else None,
                "weakest_topic": weakest_topic,
                "weak_count": len(risk_result.get("weak_competency_ids", [])),
                "grade_decline_pct": round((features or {}).get("grade_decline_pct", 0.0) or 0.0, 1),
                "reason": risk_result["reason"],
                "flagged_on": t.get("current_episode_started"),
                "school_days_waiting": t.get("school_days_waiting"),
                "overdue": bool(t.get("overdue")),
            })

    return sorted(results, key=lambda x: (x["avg_score"] if x["avg_score"] is not None else 100))


# ── Admin stats & analytics ───────────────────────────────────────────────────

@router.get("/admin/stats", response_model=AdminStats)
def get_admin_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin, UserRole.vp_academic_affairs)),
):
    from backend.models.syllabus import Syllabus
    return AdminStats(
        total_users=db.query(User).count(),
        total_students=db.query(User).filter(User.role == UserRole.student).count(),
        total_instructors=db.query(User).filter(User.role == UserRole.instructor).count(),
        total_courses=db.query(Course).count(),
        total_syllabi=db.query(Syllabus).count(),
        total_resources=db.query(Resource).count(),
    )


@router.get("/admin/ingestion-stats")
def get_ingestion_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin)),
):
    """Ingestion parse rate and latency per file type vs. the capstone §3.1
    Objective 1 targets (100% valid parsing, < 2 s per file)."""
    from backend.core.ingestion import INGESTION_TARGET_MS
    from backend.models.audit import AuditLog

    rows = db.query(AuditLog).filter(AuditLog.action == "ingestion").all()
    by_kind: dict = defaultdict(list)
    for r in rows:
        extra = r.extra_data or {}
        if "processing_ms" in extra:
            by_kind[extra.get("kind", "unknown")].append(extra)

    def pct(values, q):
        values = sorted(values)
        return round(values[min(len(values) - 1, int(round(q * (len(values) - 1))))], 1)

    result = []
    for kind, entries in sorted(by_kind.items()):
        times = [e["processing_ms"] for e in entries]
        ok = sum(1 for e in entries if e.get("parse_ok"))
        result.append({
            "kind": kind,
            "attempts": len(entries),
            "parsed_ok": ok,
            "parse_rate_pct": round(ok / len(entries) * 100, 1),
            "median_ms": pct(times, 0.5),
            "p95_ms": pct(times, 0.95),
            "within_target_pct": round(sum(1 for t in times if t < INGESTION_TARGET_MS) / len(times) * 100, 1),
        })
    return {"target_ms": INGESTION_TARGET_MS, "kinds": result}


@router.get("/admin/enrollment-trends", response_model=list[EnrollmentTrendItem])
def get_enrollment_trends(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin, UserRole.vp_academic_affairs)),
):
    courses = db.query(Course).all()
    period_data: dict = defaultdict(lambda: {"students": set(), "scores": []})

    for course in courses:
        a_ids = [str(a.id) for a in course.assessments]
        if not a_ids:
            continue
        scores = db.query(StudentScore).filter(StudentScore.assessment_id.in_(a_ids)).all()
        for s in scores:
            pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
            period_data[course.academic_period]["students"].add(s.student_id_hash)
            period_data[course.academic_period]["scores"].append(pct)

    results = []
    for period, data in sorted(period_data.items()):
        avg = sum(data["scores"]) / len(data["scores"]) if data["scores"] else None
        results.append(EnrollmentTrendItem(
            period=period,
            student_count=len(data["students"]),
            avg_score=round(avg, 2) if avg is not None else None,
        ))
    return results


@router.get("/admin/subject-performance", response_model=list[SubjectPerformanceItem])
def get_subject_performance(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin, UserRole.vp_academic_affairs)),
):
    courses = db.query(Course).all()
    results = []

    for course in courses:
        a_ids = [str(a.id) for a in course.assessments]
        if not a_ids:
            continue
        all_scores = db.query(StudentScore).filter(StudentScore.assessment_id.in_(a_ids)).all()

        student_scores: dict = defaultdict(list)
        for s in all_scores:
            pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
            student_scores[s.student_id_hash].append(pct)

        if not student_scores:
            continue

        student_avgs = [sum(v) / len(v) for v in student_scores.values()]
        total = len(student_avgs)
        failing = sum(1 for avg in student_avgs if avg < 75)
        course_avg = sum(student_avgs) / total

        results.append(SubjectPerformanceItem(
            course_id=str(course.id),
            course_code=course.code,
            course_title=course.title,
            total_students=total,
            failing_count=failing,
            failure_rate=round(failing / total * 100, 1),
            avg_score=round(course_avg, 2),
        ))

    return sorted(results, key=lambda x: x.failure_rate, reverse=True)


@router.get("/admin/audit-logs", response_model=list[AuditLogEntry])
def get_audit_logs(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin, UserRole.vp_academic_affairs)),
):
    from backend.models.audit import AuditLog
    import uuid as _uuid

    logs = (
        db.query(AuditLog)
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
        .all()
    )

    raw_ids = [log.user_id for log in logs if log.user_id]
    uuid_ids = []
    for uid in raw_ids:
        try:
            uuid_ids.append(_uuid.UUID(str(uid)))
        except (ValueError, AttributeError):
            pass

    users = db.query(User).filter(User.id.in_(uuid_ids)).all() if uuid_ids else []
    user_map = {str(u.id): u.full_name for u in users}

    return [
        AuditLogEntry(
            id=log.id,
            action=log.action,
            actor_name=user_map.get(str(log.user_id)),
            target_table=log.target_table,
            extra_data=log.extra_data,
            timestamp=log.timestamp.isoformat() if log.timestamp else "",
        )
        for log in logs
    ]


@router.get("/admin/yield-distribution", response_model=YieldDistribution)
def get_yield_distribution(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin)),
):
    all_scores = db.query(StudentScore).all()
    student_scores: dict = defaultdict(list)
    for s in all_scores:
        pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
        student_scores[s.student_id_hash].append(pct)

    # Buckets follow the capstone mastery levels (Table 3): Proficient >=85,
    # Developing 75-84, Emerging <75. See feature_engineering.mastery_level().
    proficient = developing = emerging = 0
    thresholds = get_settings(db)
    for scores in student_scores.values():
        avg = sum(scores) / len(scores)
        if avg >= thresholds.proficient_threshold:
            proficient += 1
        elif avg >= thresholds.mastery_threshold:
            developing += 1
        else:
            emerging += 1

    total = proficient + developing + emerging
    return YieldDistribution(proficient=proficient, developing=developing,
                             emerging=emerging, total=total)


# ── College-scoped analytics (Program Director / Dean) ────────────────────────

def _get_college_courses(college: str, db: Session):
    return (
        db.query(Course)
        .join(User, Course.instructor_id == User.id)
        .filter(User.college == college)
        .all()
    )


@router.get("/college/stats", response_model=CollegeStats)
def get_college_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.program_director, UserRole.dean)),
):
    from backend.models.syllabus import Syllabus
    college = current_user.college
    if not college:
        raise HTTPException(status_code=400, detail="Your account has no college assigned")

    total_instructors = (
        db.query(User)
        .filter(User.role == UserRole.instructor, User.college == college)
        .count()
    )
    courses = _get_college_courses(college, db)
    course_ids = [str(c.id) for c in courses]

    total_syllabi = (
        db.query(Syllabus).filter(Syllabus.course_id.in_(course_ids)).count()
        if course_ids else 0
    )

    assessment_ids = []
    for c in courses:
        assessment_ids.extend(str(a.id) for a in c.assessments)

    total_students = (
        db.query(StudentScore.student_id_hash)
        .filter(StudentScore.assessment_id.in_(assessment_ids))
        .distinct()
        .count()
        if assessment_ids else 0
    )

    return CollegeStats(
        total_instructors=total_instructors,
        total_courses=len(courses),
        total_syllabi=total_syllabi,
        total_students=total_students,
    )


@router.get("/college/subject-performance", response_model=list[SubjectPerformanceItem])
def get_college_subject_performance(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.program_director, UserRole.dean)),
):
    college = current_user.college
    if not college:
        raise HTTPException(status_code=400, detail="Your account has no college assigned")

    courses = _get_college_courses(college, db)
    results = []
    for course in courses:
        a_ids = [str(a.id) for a in course.assessments]
        if not a_ids:
            continue
        all_scores = db.query(StudentScore).filter(StudentScore.assessment_id.in_(a_ids)).all()
        student_scores: dict = defaultdict(list)
        for s in all_scores:
            pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
            student_scores[s.student_id_hash].append(pct)
        if not student_scores:
            continue
        student_avgs = [sum(v) / len(v) for v in student_scores.values()]
        total = len(student_avgs)
        failing = sum(1 for avg in student_avgs if avg < 75)
        results.append(SubjectPerformanceItem(
            course_id=str(course.id),
            course_code=course.code,
            course_title=course.title,
            total_students=total,
            failing_count=failing,
            failure_rate=round(failing / total * 100, 1),
            avg_score=round(sum(student_avgs) / total, 2),
        ))
    return sorted(results, key=lambda x: x.failure_rate, reverse=True)


@router.get("/college/enrollment-trends", response_model=list[EnrollmentTrendItem])
def get_college_enrollment_trends(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.program_director, UserRole.dean)),
):
    college = current_user.college
    if not college:
        raise HTTPException(status_code=400, detail="Your account has no college assigned")

    courses = _get_college_courses(college, db)
    period_data: dict = defaultdict(lambda: {"students": set(), "scores": []})
    for course in courses:
        a_ids = [str(a.id) for a in course.assessments]
        if not a_ids:
            continue
        for s in db.query(StudentScore).filter(StudentScore.assessment_id.in_(a_ids)).all():
            pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
            period_data[course.academic_period]["students"].add(s.student_id_hash)
            period_data[course.academic_period]["scores"].append(pct)

    results = []
    for period, data in sorted(period_data.items()):
        avg = sum(data["scores"]) / len(data["scores"]) if data["scores"] else None
        results.append(EnrollmentTrendItem(
            period=period,
            student_count=len(data["students"]),
            avg_score=round(avg, 2) if avg is not None else None,
        ))
    return results


# ── Student profile (instructor/admin drill-down) ─────────────────────────────

@router.get("/courses/{course_id}/students/{student_id_hash}/profile")
def get_student_profile(
    course_id: str,
    student_id_hash: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _course_read(course_id, db, current_user)
    from backend.models.syllabus import Competency

    all_students = db.query(User).filter(
        User.role == UserRole.student,
        User.student_number.isnot(None),
    ).all()
    hash_to_user = {hash_student_id(s.student_number): s for s in all_students}
    user = hash_to_user.get(student_id_hash)

    features = build_student_features(student_id_hash, course_id, db)
    risk_result = predict_risk(student_id_hash, course_id, db)
    recs = get_recommendations(risk_result.get("weak_competency_ids", []), course_id, db)

    competency_scores = []
    if features and features.get("competency_avgs"):
        for cid, avg in features["competency_avgs"].items():
            comp = db.query(Competency).filter(Competency.id == cid).first()
            if comp:
                competency_scores.append({
                    "competency_id": cid,
                    "competency_code": comp.competency_code,
                    "topic_name": comp.topic_name,
                    "average_score": round(avg, 2),
                    "is_weak": avg < get_settings(db).mastery_threshold,
                })

    a_ids = _assessment_ids(course_id, db)
    period_trend = []
    if a_ids:
        from backend.models.score import StudentScore as SS
        scores = db.query(SS).filter(
            SS.student_id_hash == student_id_hash,
            SS.assessment_id.in_(a_ids),
        ).all()
        buckets: dict = defaultdict(list)
        for s in scores:
            pct = (s.score / s.max_score * 100) if s.max_score > 0 else 0.0
            buckets[s.grading_period].append(pct)
        for label, gp in _PERIODS_ORDERED:
            v = buckets.get(gp)
            period_trend.append({"period": label, "score": round(sum(v) / len(v), 2) if v else None})

    return {
        "student_id_hash": student_id_hash,
        "full_name": user.full_name if user else f"Student {student_id_hash[:8]}…",
        "student_number": user.student_number if user else None,
        "email": user.email if user else None,
        "program": user.program if user else None,
        "year_level": user.year_level if user else None,
        "avg_score": round(features["avg_score"], 2) if features and features.get("avg_score") is not None else None,
        "risk_level": risk_result["risk_level"],
        "risk_reason": risk_result["reason"],
        "learning_gaps": len(risk_result.get("weak_competency_ids", [])),
        "competency_scores": sorted(competency_scores, key=lambda x: x["average_score"]),
        "period_trend": period_trend,
        "recommendations": [r if isinstance(r, dict) else r.model_dump() for r in recs][:6],
    }


# ── Resources CRUD ────────────────────────────────────────────────────────────

@router.get("/resources", response_model=list[ResourceResponse])
def list_resources(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from sqlalchemy import case, func as sa_func
    counts = {
        str(rid): (helpful or 0, not_helpful or 0)
        for rid, helpful, not_helpful in db.query(
            RecommendationFeedback.resource_id,
            sa_func.sum(case((RecommendationFeedback.helpful.is_(True), 1), else_=0)),
            sa_func.sum(case((RecommendationFeedback.helpful.is_(False), 1), else_=0)),
        ).group_by(RecommendationFeedback.resource_id).all()
    }
    results = []
    for r in db.query(Resource).filter(Resource.course_id.is_(None)).all():
        helpful, not_helpful = counts.get(str(r.id), (0, 0))
        item = ResourceResponse.model_validate(r)
        item.helpful_count, item.not_helpful_count = int(helpful), int(not_helpful)
        results.append(item)
    return results


@router.post("/resources", response_model=ResourceResponse, status_code=201)
def create_resource(
    payload: ResourceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    resource = Resource(**payload.model_dump())
    db.add(resource)
    db.commit()
    db.refresh(resource)
    return resource


_RESOURCE_TYPES = {"video", "reading", "exercise"}


@router.put("/resources/{resource_id}", response_model=ResourceResponse)
def update_resource(
    resource_id: str,
    payload: ResourceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    for field, value in payload.model_dump().items():
        setattr(resource, field, value)
    db.commit()
    db.refresh(resource)
    return resource


@router.post("/resources/bulk-import")
def bulk_import_resources(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    """CSV columns: title, type (video/reading/exercise), url required; competency_tags
    (comma- or semicolon-separated), description optional. Bad rows are reported, not fatal."""
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted")
    reader = csv.DictReader(io.StringIO(file.file.read().decode("utf-8-sig")))
    if not {"title", "type", "url"}.issubset(set(reader.fieldnames or [])):
        raise HTTPException(status_code=400, detail="CSV must contain the columns: title, type, url")
    existing_urls = {u for (u,) in db.query(Resource.url).filter(Resource.course_id.is_(None)).all()}
    imported, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):
        title = (row.get("title") or "").strip()
        rtype = (row.get("type") or "").strip().lower()
        url = (row.get("url") or "").strip()
        missing = [k for k, v in (("title", title), ("type", rtype), ("url", url)) if not v]
        if missing:
            errors.append(f"Row {i}: missing {', '.join(missing)}")
            continue
        if rtype not in _RESOURCE_TYPES:
            errors.append(f"Row {i}: type '{rtype}' must be video, reading or exercise")
            continue
        if url in existing_urls:
            skipped += 1
            errors.append(f"Row {i}: '{title}' skipped, a resource with this URL already exists")
            continue
        tags = [t.strip() for t in (row.get("competency_tags") or "").replace(";", ",").split(",") if t.strip()]
        db.add(Resource(title=title, type=rtype, url=url, competency_tags=tags,
                        description=(row.get("description") or "").strip() or None))
        existing_urls.add(url)
        imported += 1
    db.commit()
    return {"imported": imported, "skipped": skipped, "errors": errors}


@router.delete("/resources/{resource_id}", status_code=204)
def delete_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    db.delete(resource)
    db.commit()


# ── Instructor interventions ──────────────────────────────────────────────────

@router.post("/courses/{course_id}/interventions", status_code=201)
def create_intervention(
    course_id: str,
    body: InterventionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if current_user.role != UserRole.admin and str(course.instructor_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="You do not own this course")

    from datetime import date as DateType
    follow_up = None
    if body.follow_up_date:
        try:
            follow_up = DateType.fromisoformat(body.follow_up_date)
        except ValueError:
            pass

    intervention = InstructorIntervention(
        instructor_id=current_user.id,
        course_id=course_id,
        student_id_hash=body.student_id_hash,
        action_type=body.action_type,
        intervention_type=body.intervention_type,
        note=body.note,
        goal_description=body.goal_description,
        target_score=body.target_score,
        target_period=body.target_period,
        follow_up_date=follow_up,
        ai_feedback=_intervention_ai_feedback(body.student_id_hash, course_id, db),
    )
    db.add(intervention)
    db.commit()
    db.refresh(intervention)
    return InterventionOut.model_validate(intervention)


def _intervention_ai_feedback(student_id_hash: str, course_id: str, db: Session) -> str | None:
    """AI feedback logged with the intervention (capstone §3.4): the recommender's
    GPT encouragement for the student's current gaps, or None when the LLM is off."""
    try:
        weak = predict_risk(student_id_hash, course_id, db).get("weak_competency_ids", [])
        recs = get_recommendations(weak, course_id, db) if weak else []
        return recs[0].get("personalized_message") if recs else None
    except Exception:
        return None


@router.put("/interventions/{intervention_id}/status")
def update_intervention_status(
    intervention_id: uuid.UUID,
    body: InterventionStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    """Track an intervention through open -> in_progress -> resolved (capstone §3.4)."""
    from datetime import datetime as _dt
    intervention = db.query(InstructorIntervention).filter(InstructorIntervention.id == intervention_id).first()
    if not intervention:
        raise HTTPException(status_code=404, detail="Intervention not found")
    if current_user.role != UserRole.admin and str(intervention.instructor_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="You did not log this intervention")
    intervention.status = body.status
    intervention.status_updated_at = _dt.utcnow()
    db.commit()
    db.refresh(intervention)
    return InterventionOut.model_validate(intervention)


@router.get("/instructor/interventions")
def list_instructor_interventions(
    type_filter: Optional[str] = Query(None, alias="type"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    q = db.query(InstructorIntervention).filter(
        InstructorIntervention.instructor_id == current_user.id
    )
    if type_filter:
        q = q.filter(InstructorIntervention.intervention_type == type_filter)
    rows = q.order_by(InstructorIntervention.created_at.desc()).limit(50).all()
    return [InterventionOut.model_validate(r) for r in rows]


@router.get("/me/interventions")
def get_my_interventions(
    course_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        return []
    sid_hash = hash_student_id(current_user.student_number)
    q = db.query(InstructorIntervention).filter(
        InstructorIntervention.student_id_hash == sid_hash
    )
    if course_id:
        q = q.filter(InstructorIntervention.course_id == course_id)
    rows = q.order_by(InstructorIntervention.created_at.desc()).limit(20).all()
    return [InterventionOut.model_validate(r) for r in rows]


@router.get("/me/attendance")
def get_my_attendance(
    course_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        return {"total_sessions": 0, "present_count": 0, "absent_count": 0,
                "late_count": 0, "excused_count": 0, "absence_rate": 0.0, "records": []}
    sid_hash = hash_student_id(current_user.student_number)
    records = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.student_id_hash == sid_hash,
            AttendanceRecord.course_id == course_id,
        )
        .order_by(AttendanceRecord.date.desc())
        .all()
    )
    dates = set(r.date for r in records)
    total_sessions = len(dates)
    absent_count = sum(1 for r in records if r.status == AttendanceStatus.absent)
    present_count = sum(1 for r in records if r.status == AttendanceStatus.present)
    late_count = sum(1 for r in records if r.status == AttendanceStatus.late)
    excused_count = sum(1 for r in records if r.status == AttendanceStatus.excused)
    return {
        "total_sessions": total_sessions,
        "present_count": present_count,
        "absent_count": absent_count,
        "late_count": late_count,
        "excused_count": excused_count,
        "absence_rate": round(absent_count / total_sessions, 3) if total_sessions > 0 else 0.0,
        "records": [{"date": str(r.date), "status": r.status.value} for r in records],
    }


@router.get("/courses/{course_id}/students/{student_id_hash}/interventions")
def list_interventions(
    course_id: str,
    student_id_hash: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _course_read(course_id, db, current_user)
    rows = (
        db.query(InstructorIntervention)
        .filter(
            InstructorIntervention.course_id == course_id,
            InstructorIntervention.student_id_hash == student_id_hash,
        )
        .order_by(InstructorIntervention.created_at.desc())
        .all()
    )
    return [InterventionOut.model_validate(r) for r in rows]


# ── Student-accept improvement plan ──────────────────────────────────────────

@router.put("/interventions/{intervention_id}/student-accept", status_code=200)
def student_accept_intervention(
    intervention_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.student_number:
        raise HTTPException(status_code=400, detail="No student number on file")
    sid_hash = hash_student_id(current_user.student_number)
    iv = db.query(InstructorIntervention).filter(InstructorIntervention.id == intervention_id).first()
    if not iv:
        raise HTTPException(status_code=404, detail="Intervention not found")
    if iv.student_id_hash != sid_hash:
        raise HTTPException(status_code=403, detail="Not your intervention plan")
    iv.plan_accepted_by_student = True
    db.commit()
    return InterventionOut.model_validate(iv)


# ── Grade Consultations ───────────────────────────────────────────────────────

def _consultation_response(c: GradeConsultation, hash_to_user: dict) -> dict:
    user = hash_to_user.get(c.student_id_hash)
    from datetime import date as DateType
    return {
        "id": str(c.id),
        "instructor_id": str(c.instructor_id),
        "course_id": str(c.course_id),
        "student_id_hash": c.student_id_hash,
        "full_name": user.full_name if user else None,
        "student_number": user.student_number if user else None,
        "grading_period": c.grading_period.value if c.grading_period else None,
        "conducted_at": c.conducted_at.isoformat() if c.conducted_at else None,
        "academic_status": c.academic_status.value if c.academic_status else None,
        "notes": c.notes,
        "next_steps": c.next_steps,
        "incomplete_reason": c.incomplete_reason,
        "completion_deadline": str(c.completion_deadline) if c.completion_deadline else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.post("/courses/{course_id}/consultations", status_code=201)
def create_consultation(
    course_id: str,
    body: GradeConsultationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _course_read(course_id, db, current_user)
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    from datetime import datetime as dt, date as DateType
    conducted = None
    if body.conducted_at:
        try:
            conducted = dt.fromisoformat(body.conducted_at)
        except ValueError:
            pass

    deadline = None
    if body.completion_deadline:
        try:
            deadline = DateType.fromisoformat(body.completion_deadline)
        except ValueError:
            pass

    c = GradeConsultation(
        instructor_id=current_user.id,
        course_id=course_id,
        student_id_hash=body.student_id_hash,
        grading_period=body.grading_period,
        conducted_at=conducted,
        academic_status=body.academic_status,
        notes=body.notes,
        next_steps=body.next_steps,
        incomplete_reason=body.incomplete_reason,
        completion_deadline=deadline,
        advising_type=body.advising_type,
        advising_content=body.advising_content,
        retake_recommended=body.retake_recommended,
        retake_notes=body.retake_notes,
    )
    db.add(c)
    db.commit()
    db.refresh(c)

    # T5-D-04: recompute academic standing after every consultation
    if body.academic_status:
        upsert_academic_standing(body.student_id_hash, course_id, db)

    all_students = db.query(User).filter(
        User.role == UserRole.student, User.student_number.isnot(None)
    ).all()
    hash_to_user = {hash_student_id(s.student_number): s for s in all_students}
    return _consultation_response(c, hash_to_user)


@router.get("/courses/{course_id}/consultations")
def list_consultations(
    course_id: str,
    student_id_hash: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _course_read(course_id, db, current_user)
    q = db.query(GradeConsultation).filter(GradeConsultation.course_id == course_id)
    if student_id_hash:
        q = q.filter(GradeConsultation.student_id_hash == student_id_hash)
    rows = q.order_by(GradeConsultation.created_at.desc()).all()

    all_students = db.query(User).filter(
        User.role == UserRole.student, User.student_number.isnot(None)
    ).all()
    hash_to_user = {hash_student_id(s.student_number): s for s in all_students}
    return [_consultation_response(r, hash_to_user) for r in rows]


@router.get("/instructor/consultations")
def list_instructor_consultations(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    q = db.query(GradeConsultation).filter(
        GradeConsultation.instructor_id == current_user.id
    )
    if status_filter:
        q = q.filter(GradeConsultation.academic_status == status_filter)
    rows = q.order_by(GradeConsultation.created_at.desc()).limit(50).all()

    all_students = db.query(User).filter(
        User.role == UserRole.student, User.student_number.isnot(None)
    ).all()
    hash_to_user = {hash_student_id(s.student_number): s for s in all_students}
    return [_consultation_response(r, hash_to_user) for r in rows]


@router.get("/me/consultations")
def get_my_consultations(
    course_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        return []
    sid_hash = hash_student_id(current_user.student_number)
    q = db.query(GradeConsultation).filter(
        GradeConsultation.student_id_hash == sid_hash
    )
    if course_id:
        q = q.filter(GradeConsultation.course_id == course_id)
    rows = q.order_by(GradeConsultation.created_at.desc()).limit(10).all()
    return [_consultation_response(r, {sid_hash: current_user}) for r in rows]


# ── T5-D-05: Student academic standing ───────────────────────────────────────

@router.get("/me/academic-standing")
def get_my_academic_standing(
    course_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.student)),
    _: None = Depends(require_consent),
):
    if not current_user.student_number:
        return {"standing": "good", "computed_at": None}
    sid_hash = hash_student_id(current_user.student_number)
    record = db.query(AcademicStanding).filter(
        AcademicStanding.student_id_hash == sid_hash,
        AcademicStanding.course_id == course_id,
    ).first()
    if not record:
        return {"standing": "good", "computed_at": None}
    return {"standing": record.standing.value, "computed_at": record.computed_at}


# ── T5-D-07: Instructor standing summary ─────────────────────────────────────

@router.get("/instructor/standing-summary")
def get_instructor_standing_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    courses = db.query(Course).filter(Course.instructor_id == current_user.id).all()
    if not courses:
        return {"warning": 0, "probation": 0, "dismissal_risk": 0, "students": []}

    course_ids = [str(c.id) for c in courses]
    course_map = {str(c.id): c for c in courses}

    rows = db.query(AcademicStanding).filter(
        AcademicStanding.course_id.in_(course_ids),
        AcademicStanding.standing != AcademicStandingLevel.good,
    ).all()

    all_students = db.query(User).filter(
        User.role == UserRole.student, User.student_number.isnot(None)
    ).all()
    hash_to_user = {hash_student_id(s.student_number): s for s in all_students}

    students = []
    for r in rows:
        u = hash_to_user.get(r.student_id_hash)
        c = course_map.get(str(r.course_id))
        students.append({
            "student_id_hash": r.student_id_hash,
            "full_name": u.full_name if u else "Unknown",
            "student_number": u.student_number if u else None,
            "course_code": c.course_code if c else str(r.course_id),
            "standing": r.standing.value,
            "computed_at": r.computed_at,
        })

    from collections import Counter
    counts = Counter(r.standing.value for r in rows)
    return {
        "warning": counts.get("warning", 0),
        "probation": counts.get("probation", 0),
        "dismissal_risk": counts.get("dismissal_risk", 0),
        "students": sorted(students, key=lambda s: (
            ["dismissal_risk", "probation", "warning"].index(s["standing"])
        )),
    }




@router.get("/early-warning")
def early_warning_timeliness(
    course_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin, UserRole.program_director,
                                              UserRole.dean, UserRole.vp_academic_affairs)),
):
    """Panel comment 3: how early students are flagged and how fast interventions follow."""
    from backend.services.early_warning import timeliness
    from backend.services.reports.data import scoped_courses

    courses = scoped_courses(db, current_user)
    if course_id:
        courses = [c for c in courses if str(c.id) == course_id]
    data = timeliness([c.id for c in courses], db)
    names = {hash_student_id(u.student_number): u for u in db.query(User).filter(
        User.role == UserRole.student, User.student_number.isnot(None)).all()}
    codes = {str(c.id): c.code for c in courses}
    for r in data["rows"]:
        u = names.get(r["student_id_hash"])
        r["full_name"] = u.full_name if u else f"Student {r['student_id_hash'][:8]}"
        r["course_code"] = codes.get(r["course_id"])
    data["rows"].sort(key=lambda r: (not r["overdue"], not r["currently_at_risk"], r["first_flagged_on"] or ""))
    return data
