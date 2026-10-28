import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from backend.core.access import assert_course_read_access
from backend.core.audit import log_action
from backend.core.ingestion import record_ingestion
from backend.core.database import get_db
from backend.core.deps import get_current_user, require_role
from backend.core.notifications import notify, notify_roles
from backend.models.user import User, UserRole
from backend.models.course import Course
from backend.models.assessment import Assessment, AssessmentItem, AssessmentApproval, AssessmentApprovalStatus
from backend.models.syllabus import Competency, SyllabusStatus
from backend.models.score import StudentScore
from backend.schemas.assessment import (
    AssessmentCreate, AssessmentResponse, AssessmentItemResponse, UploadSummary,
    AssessmentApprovalCreate, AssessmentApprovalResponse, AssessmentQueueItem,
)
from backend.schemas.tos import TosCreate, TosResponse
from backend.models.tos import TableOfSpecifications
from backend.services.assessment.alignment import alignment_hints
from backend.services.assessment.csv_parser import parse_assessment_csv
from backend.services.ai.topic_mapper import map_question_to_competency
from backend.services.analytics_refresh import refresh_course_analytics
from backend.services.institution_settings import get_settings
from backend.core.limiter import limiter

router = APIRouter(prefix="/assessments", tags=["assessments"])

ASSESSMENT_APPROVER_ROLES = {UserRole.program_director}

ALLOWED_CSV_MIME = {"text/csv", "application/csv", "text/plain", "application/octet-stream"}


def _owned_assessment(assessment_id, db: Session, current_user: User) -> Assessment:
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    _assert_course_access(assessment.course, current_user)
    return assessment


def _assert_course_access(course: Course, current_user: User):
    """Raise 403 if instructor does not own this course."""
    if current_user.role == UserRole.admin:
        return
    if str(course.instructor_id) != str(current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this course")


def _parse_uuid(value: str, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid {field}")


def _get_item_for_edit(item_id: str, db: Session, current_user: User) -> AssessmentItem:
    """Load an assessment item and verify the caller owns its course."""
    item = db.query(AssessmentItem).filter(
        AssessmentItem.id == _parse_uuid(item_id, "item_id")
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    course = db.query(Course).filter(Course.id == item.assessment.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_access(course, current_user)
    return item


def _override_action(item: AssessmentItem) -> str | None:
    """How faculty resolved an item's mapping (capstone §3.6.2): accepted the AI's
    suggestion, reassigned it, tagged it with a faculty-created topic, or tagged an
    item the AI never suggested anything for (manual). None while unreviewed."""
    if item.validated_by is None:
        return None
    if item.mapped_competency is not None and getattr(item.mapped_competency, "source", None) == "faculty":
        return "custom"
    if item.ai_suggested_competency_id is None:
        return "manual"
    return "accepted" if item.ai_suggested_competency_id == item.mapped_competency_id else "reassigned"


MAPPING_CONCURRENCY = 8


def _run_topic_mapping(assessment_id: str, db: Session):
    """Background job after a CSV upload: AI-map untagged items, then refresh the
    course's competency mastery (also needed when every item was pre-tagged)."""
    _map_unmapped_items(assessment_id, db)
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if assessment:
        refresh_course_analytics(assessment.course_id, db)


def _map_unmapped_items(assessment_id: str, db: Session):
    items = db.query(AssessmentItem).filter(
        AssessmentItem.assessment_id == assessment_id,
        AssessmentItem.mapped_competency_id == None,
    ).all()
    if not items:
        return

    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    syllabus = (
        db.query(Competency)
        .join(Competency.syllabus)
        .filter_by(course_id=assessment.course_id, status=SyllabusStatus.validated)
        .first()
    )
    if not syllabus:
        return

    competencies = db.query(Competency).filter(
        Competency.syllabus_id == syllabus.syllabus_id
    ).all()
    comp_list = [
        {"competency_code": c.competency_code, "topic_name": c.topic_name, "learning_outcomes": c.learning_outcomes}
        for c in competencies
    ]
    comp_map = {c.competency_code: c for c in competencies}
    thresholds = get_settings(db)

    # LLM calls run concurrently so a whole CSV maps within the capstone's
    # "< 5 s per mapping batch" target; DB writes stay on this thread.
    def _map(question_text):
        try:
            return map_question_to_competency(question_text, comp_list)
        except Exception as exc:
            return exc

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=MAPPING_CONCURRENCY) as pool:
        results = list(pool.map(_map, [item.question_text for item in items]))
    batch_ms = (time.perf_counter() - started) * 1000

    for item, result in zip(items, results):
        try:
            if isinstance(result, Exception):
                raise result
            code = result.get("competency_code")
            score = result.get("confidence_score", 0.0)
            item.confidence_score = score
            # Confidence only prioritizes review. With auto-accept off (pilot default) every
            # AI mapping is provisional until a faculty member confirms it (panel comment 1).
            item.needs_review = (not thresholds.mapping_auto_accept) or score < thresholds.mapping_review_threshold
            item.bloom_level = result.get("bloom_level")
            item.ai_confidence = score
            item.ai_mapped_at = datetime.now(timezone.utc)
            if code and code in comp_map:
                item.mapped_competency_id = comp_map[code].id
                item.ai_suggested_competency_id = comp_map[code].id
        except Exception:
            item.needs_review = True

    db.flush()
    failed = sum(1 for r in results if isinstance(r, Exception))
    record_ingestion(db, None, "topic_mapping_batch", failed == 0, batch_ms,
                     assessment_id=str(assessment_id), items=len(items), failed=failed)

    # Propagate mapped competency to linked student scores
    for item in items:
        if item.mapped_competency_id:
            db.query(StudentScore).filter(StudentScore.item_id == item.id).update(
                {"competency_id": item.mapped_competency_id},
                synchronize_session=False,
            )

    db.commit()


@router.get("/pending-approval", response_model=list[AssessmentQueueItem])
def get_pending_approval(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ASSESSMENT_APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Only Program Directors can view the assessment queue")
    q = db.query(Assessment).filter(Assessment.approval_status == AssessmentApprovalStatus.pending_pd)
    if current_user.college:
        q = (
            q.join(Course, Assessment.course_id == Course.id)
            .join(User, Course.instructor_id == User.id)
            .filter(User.college == current_user.college)
        )
    out = []
    for a in q.all():
        course = a.course
        instructor = db.get(User, course.instructor_id) if course else None
        out.append(AssessmentQueueItem(
            **AssessmentResponse.model_validate(a).model_dump(),
            course_code=course.code if course else None,
            course_title=course.title if course else None,
            course_academic_period=course.academic_period if course else None,
            instructor_name=instructor.full_name if instructor else None,
        ))
    return out


REVIEWER_ROLES = {UserRole.program_director, UserRole.dean, UserRole.vp_academic_affairs}


@router.get("/{assessment_id}/alignment-hints")
def get_alignment_hints(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Advisory TOS / Bloom alignment hints for the assessment review (§3.11.2)."""
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    course = db.query(Course).filter(Course.id == assessment.course_id).first()
    if current_user.role in REVIEWER_ROLES:
        if current_user.college and current_user.role != UserRole.vp_academic_affairs:
            instructor = db.query(User).filter(User.id == course.instructor_id).first() if course else None
            if not instructor or instructor.college != current_user.college:
                raise HTTPException(status_code=403, detail="Assessment is outside your college")
    elif current_user.role in (UserRole.instructor, UserRole.admin):
        _assert_course_access(course, current_user)
    else:
        raise HTTPException(status_code=403, detail="Not allowed")
    return alignment_hints(assessment, db)


@router.get("/course/{course_id}", response_model=list[AssessmentResponse])
def list_course_assessments(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_access(course, current_user)
    return (
        db.query(Assessment)
        .filter(Assessment.course_id == course_id)
        .order_by(Assessment.grading_period, Assessment.created_at)
        .all()
    )


@router.post("/{course_id}", response_model=AssessmentResponse, status_code=status.HTTP_201_CREATED)
def create_assessment(
    course_id: str,
    payload: AssessmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_access(course, current_user)
    assessment = Assessment(course_id=course_id, **payload.model_dump())
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment


@router.post("/{assessment_id}/submit-for-review", response_model=AssessmentResponse)
def submit_assessment_for_review(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.approval_status not in (AssessmentApprovalStatus.draft, AssessmentApprovalStatus.rejected):
        raise HTTPException(status_code=400, detail=f"Cannot submit from status '{assessment.approval_status}'")
    course = db.query(Course).filter(Course.id == assessment.course_id).first()
    if course:
        _assert_course_access(course, current_user)
    assessment.approval_status = AssessmentApprovalStatus.pending_pd
    notify_roles(db, [UserRole.program_director], current_user.college,
                 "assessment_submitted", "Assessment Pending Review",
                 f"An assessment '{assessment.title}' has been submitted for review by {current_user.full_name}.",
                 related_id=assessment_id)
    db.commit()
    db.refresh(assessment)
    log_action(db, str(current_user.id), "submit_assessment_for_review", target_table="assessments", target_id=assessment_id)
    return assessment


@router.post("/{assessment_id}/approve", response_model=AssessmentResponse)
def approve_assessment(
    assessment_id: uuid.UUID,
    payload: AssessmentApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ASSESSMENT_APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Only Program Directors can approve assessments")
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    assert_course_read_access(assessment.course.instructor_id, current_user, db)  # PD: own college only
    if assessment.approval_status != AssessmentApprovalStatus.pending_pd:
        raise HTTPException(status_code=400, detail=f"Assessment is not pending PD approval (current: {assessment.approval_status})")
    approval = AssessmentApproval(
        assessment_id=assessment.id,
        approver_id=current_user.id,
        role=current_user.role.value,
        status="approved",
        **payload.model_dump(),
    )
    db.add(approval)
    assessment.approval_status = AssessmentApprovalStatus.approved
    course = db.query(Course).filter(Course.id == assessment.course_id).first()
    if course:
        notify(db, str(course.instructor_id), "assessment_approved",
               "Assessment Approved",
               f"Your assessment '{assessment.title}' has been approved. You can now upload grades.",
               related_id=assessment_id)
    db.commit()
    db.refresh(assessment)
    log_action(db, str(current_user.id), "approve_assessment", target_table="assessments", target_id=assessment_id)
    return assessment


@router.post("/{assessment_id}/reject", response_model=AssessmentResponse)
def reject_assessment(
    assessment_id: uuid.UUID,
    payload: AssessmentApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ASSESSMENT_APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Only Program Directors can reject assessments")
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    assert_course_read_access(assessment.course.instructor_id, current_user, db)  # PD: own college only
    if assessment.approval_status != AssessmentApprovalStatus.pending_pd:
        raise HTTPException(status_code=400, detail=f"Assessment is not pending PD approval (current: {assessment.approval_status})")
    approval = AssessmentApproval(
        assessment_id=assessment.id,
        approver_id=current_user.id,
        role=current_user.role.value,
        status="rejected",
        **payload.model_dump(),
    )
    db.add(approval)
    assessment.approval_status = AssessmentApprovalStatus.rejected
    course = db.query(Course).filter(Course.id == assessment.course_id).first()
    if course:
        notify(db, str(course.instructor_id), "assessment_rejected",
               "Assessment Rejected",
               f"Your assessment '{assessment.title}' was rejected. Reason: {payload.feedback or 'No reason provided.'}",
               related_id=assessment_id)
    db.commit()
    db.refresh(assessment)
    log_action(db, str(current_user.id), "reject_assessment", target_table="assessments", target_id=assessment_id,
               extra={"feedback": payload.feedback})
    return assessment


@router.post("/{assessment_id}/resubmit", response_model=AssessmentResponse)
def resubmit_assessment(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.approval_status != AssessmentApprovalStatus.rejected:
        raise HTTPException(status_code=400, detail="Can only resubmit a rejected assessment")
    course = db.query(Course).filter(Course.id == assessment.course_id).first()
    if course:
        _assert_course_access(course, current_user)
    assessment.approval_status = AssessmentApprovalStatus.pending_pd
    db.commit()
    db.refresh(assessment)
    log_action(db, str(current_user.id), "resubmit_assessment", target_table="assessments", target_id=assessment_id)
    return assessment


@router.get("/{assessment_id}/approval-history", response_model=list[AssessmentApprovalResponse])
def get_assessment_approval_history(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    assert_course_read_access(assessment.course.instructor_id, current_user, db)
    return db.query(AssessmentApproval).filter(
        AssessmentApproval.assessment_id == assessment_id
    ).order_by(AssessmentApproval.reviewed_at).all()


@router.get("/{assessment_id}/tos", response_model=list[TosResponse])
def get_tos(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    assert_course_read_access(assessment.course.instructor_id, current_user, db)
    entries = db.query(TableOfSpecifications).filter(
        TableOfSpecifications.assessment_id == assessment_id
    ).all()
    result = []
    for e in entries:
        comp = e.competency
        result.append(TosResponse(
            id=e.id,
            assessment_id=e.assessment_id,
            competency_id=e.competency_id,
            bloom_level=e.bloom_level,
            item_count=e.item_count,
            weight_percent=e.weight_percent,
            competency_code=comp.competency_code if comp else None,
            topic_name=comp.topic_name if comp else None,
        ))
    return result


@router.post("/{assessment_id}/tos", response_model=TosResponse, status_code=status.HTTP_201_CREATED)
def upsert_tos_entry(
    assessment_id: uuid.UUID,
    payload: TosCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    _assert_course_access(assessment.course, current_user)
    comp = db.query(Competency).join(Competency.syllabus).filter(
        Competency.id == payload.competency_id).first()
    if comp is None or str(comp.syllabus.course_id) != str(assessment.course_id):
        raise HTTPException(status_code=422, detail="Choose a competency from this course's syllabus")
    existing = db.query(TableOfSpecifications).filter(
        TableOfSpecifications.assessment_id == assessment_id,
        TableOfSpecifications.competency_id == str(payload.competency_id),
    ).first()
    if existing:
        existing.bloom_level = payload.bloom_level
        existing.item_count = payload.item_count
        existing.weight_percent = payload.weight_percent
        db.commit()
        db.refresh(existing)
        comp = existing.competency
        return TosResponse(
            id=existing.id, assessment_id=existing.assessment_id,
            competency_id=existing.competency_id, bloom_level=existing.bloom_level,
            item_count=existing.item_count, weight_percent=existing.weight_percent,
            competency_code=comp.competency_code if comp else None,
            topic_name=comp.topic_name if comp else None,
        )
    entry = TableOfSpecifications(assessment_id=assessment_id, **payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    comp = entry.competency
    return TosResponse(
        id=entry.id, assessment_id=entry.assessment_id,
        competency_id=entry.competency_id, bloom_level=entry.bloom_level,
        item_count=entry.item_count, weight_percent=entry.weight_percent,
        competency_code=comp.competency_code if comp else None,
        topic_name=comp.topic_name if comp else None,
    )


@router.delete("/{assessment_id}/tos/{tos_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tos_entry(
    assessment_id: uuid.UUID,
    tos_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    entry = db.query(TableOfSpecifications).filter(
        TableOfSpecifications.id == tos_id,
        TableOfSpecifications.assessment_id == assessment_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="TOS entry not found")
    _assert_course_access(entry.assessment.course, current_user)
    db.delete(entry)
    db.commit()


@router.post("/{assessment_id}/upload", response_model=UploadSummary)
@limiter.limit("10/minute")
async def upload_csv(
    request: Request,
    assessment_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    if assessment.approval_status != AssessmentApprovalStatus.approved:
        raise HTTPException(
            status_code=403,
            detail=f"Assessment must be approved by the Program Director before uploading grades. Current status: {assessment.approval_status.value}",
        )

    course = db.query(Course).filter(Course.id == assessment.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_access(course, current_user)

    if file.content_type not in ALLOWED_CSV_MIME:
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")

    file_bytes = await file.read()
    started = time.perf_counter()
    try:
        records = parse_assessment_csv(file_bytes)
    except ValueError as e:
        record_ingestion(db, str(current_user.id), "assessment_csv", False,
                         (time.perf_counter() - started) * 1000, file.filename, error=str(e)[:200])
        raise HTTPException(status_code=422, detail=str(e))
    parse_ms = (time.perf_counter() - started) * 1000

    # One AssessmentItem per distinct question (not per CSV row); every student's
    # score row points at the shared item. Questions already uploaded to this
    # assessment are reused so a second batch of students doesn't duplicate them.
    def _question_key(text: str) -> str:
        return " ".join(text.split()).lower()

    csv_codes = {}  # question key -> competency_code supplied in the CSV
    for rec in records:
        code = rec.get("competency_code")
        if not code:
            continue
        key = _question_key(rec["question_text"])
        if csv_codes.setdefault(key, code) != code:
            raise HTTPException(
                status_code=422,
                detail=f"Question tagged with conflicting competency codes ({csv_codes[key]}, {code}): "
                       f"\"{rec['question_text'][:80]}\"",
            )

    comp_by_code = {}
    if csv_codes:
        course_comps = (
            db.query(Competency)
            .join(Competency.syllabus)
            .filter_by(course_id=assessment.course_id, status=SyllabusStatus.validated)
            .all()
        )
        if not course_comps:
            raise HTTPException(
                status_code=422,
                detail="The CSV has a competency_code column, but this course has no validated syllabus to match codes against.",
            )
        comp_by_code = {c.competency_code.strip().upper(): c for c in course_comps}
        unknown = sorted(set(csv_codes.values()) - comp_by_code.keys())
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown competency_code(s): {', '.join(unknown)}. "
                       f"Valid codes for this course: {', '.join(sorted(comp_by_code))}",
            )

    items_by_key = {
        _question_key(item.question_text): item
        for item in db.query(AssessmentItem).filter(AssessmentItem.assessment_id == assessment_id).all()
    }
    items_created = 0
    touched = {}  # question key -> item, for questions present in this upload

    for key, code in csv_codes.items():
        item = items_by_key.get(key)
        if item is None:
            continue
        # An explicit instructor tag overrides any earlier AI/manual mapping.
        item.mapped_competency_id = comp_by_code[code].id
        item.confidence_score = 1.0
        item.needs_review = False
        item.validated_by = current_user.id
        db.query(StudentScore).filter(StudentScore.item_id == item.id).update(
            {"competency_id": item.mapped_competency_id}, synchronize_session=False,
        )

    for rec in records:
        key = _question_key(rec["question_text"])
        item = items_by_key.get(key)
        if item is None:
            code = csv_codes.get(key)
            item = AssessmentItem(
                assessment_id=assessment_id,
                question_text=rec["question_text"],
                needs_review=False,
            )
            if code:
                item.mapped_competency_id = comp_by_code[code].id
                item.confidence_score = 1.0
                item.validated_by = current_user.id
            db.add(item)
            db.flush()
            items_by_key[key] = item
            items_created += 1
        touched[key] = item

        score_entry = StudentScore(
            student_id_hash=rec["student_id_hash"],
            assessment_id=assessment_id,
            item_id=item.id,
            competency_id=item.mapped_competency_id,
            grading_period=assessment.grading_period,
            score=rec["score"],
            max_score=rec["max_score"],
            submission_date=rec.get("submission_date"),
        )
        db.add(score_entry)

    # Questions in this upload: tagged via competency_code vs. left for topic mapping
    pre_tagged = sum(1 for key in touched if key in csv_codes)
    flagged = sum(1 for item in touched.values() if item.mapped_competency_id is None)

    db.commit()

    log_action(db, str(current_user.id), "upload_csv", target_table="assessments",
               target_id=str(assessment_id), extra={"rows": len(records), "filename": file.filename})
    record_ingestion(db, str(current_user.id), "assessment_csv", True,
                     (time.perf_counter() - started) * 1000, file.filename,
                     parse_ms=round(parse_ms, 1), rows=len(records))
    background_tasks.add_task(_run_topic_mapping, assessment_id, db)

    return UploadSummary(
        total_rows=len(records),
        valid_rows=len(records),
        items_created=items_created,
        questions=len(touched),
        pre_tagged=pre_tagged,
        flagged_for_review=flagged,
    )


@router.get("/{assessment_id}/items")
def get_items(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _owned_assessment(assessment_id, db, current_user)
    items = db.query(AssessmentItem).filter(AssessmentItem.assessment_id == assessment_id).all()
    return [
        {
            "id": str(item.id),
            "question_text": item.question_text,
            "mapped_competency_id": str(item.mapped_competency_id) if item.mapped_competency_id else None,
            "competency_code": item.mapped_competency.competency_code if item.mapped_competency else None,
            "topic_name": item.mapped_competency.topic_name if item.mapped_competency else None,
            "confidence_score": item.confidence_score,
            "needs_review": item.needs_review,
            # Capstone §3.4 / ERD names (alongside legacy keys for the frontend):
            "mapping_confidence": item.confidence_score,
            "requires_review": item.needs_review,
            "validated_by": str(item.validated_by) if item.validated_by else None,
            "bloom_level": item.bloom_level,
            "ai_suggested_competency_id": (
                str(item.ai_suggested_competency_id) if item.ai_suggested_competency_id else None
            ),
            "ai_suggested_competency_code": (
                item.ai_suggested_competency.competency_code if item.ai_suggested_competency else None
            ),
            "ai_confidence": item.ai_confidence,
            "override_action": _override_action(item),
        }
        for item in items
    ]


@router.get("/{assessment_id}/mapping-queue")
def get_mapping_queue(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _owned_assessment(assessment_id, db, current_user)
    items = db.query(AssessmentItem).filter(
        AssessmentItem.assessment_id == assessment_id,
        AssessmentItem.needs_review == True,
    ).all()
    return [
        {
            "id": str(item.id),
            "question_text": item.question_text,
            "mapped_competency_id": str(item.mapped_competency_id) if item.mapped_competency_id else None,
            "mapped_competency_code": item.mapped_competency.competency_code if item.mapped_competency else None,
            "mapped_topic_name": item.mapped_competency.topic_name if item.mapped_competency else None,
            "confidence_score": item.confidence_score,
            "needs_review": item.needs_review,
            # Capstone §3.4 / ERD names (alongside legacy keys for the frontend):
            "mapping_confidence": item.confidence_score,
            "requires_review": item.needs_review,
        }
        for item in items
    ]


MAPPING_ACCURACY_TARGET = 85.0


@router.get("/course/{course_id}/mapping-accuracy")
def get_mapping_accuracy(
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    """Mapping accuracy audit (capstone §3.6.2): the AI's initial mapping vs. the final
    faculty decision. Only items the AI mapped AND a faculty member reviewed count;
    auto-accepted items without review have no ground truth and are reported apart."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_access(course, current_user)

    items = (
        db.query(AssessmentItem)
        .join(Assessment, AssessmentItem.assessment_id == Assessment.id)
        .filter(Assessment.course_id == course_id)
        .all()
    )
    ai_items = [i for i in items if i.ai_mapped_at is not None or i.ai_suggested_competency_id is not None]
    reviewed = [i for i in ai_items if i.validated_by is not None]
    matched = [i for i in reviewed if i.ai_suggested_competency_id == i.mapped_competency_id]

    by_comp: dict = {}
    for i in reviewed:
        comp = i.mapped_competency
        key = str(i.mapped_competency_id)
        row = by_comp.setdefault(key, {
            "competency_id": key,
            "competency_code": comp.competency_code if comp else None,
            "topic_name": comp.topic_name if comp else None,
            "reviewed": 0,
            "matched": 0,
        })
        row["reviewed"] += 1
        row["matched"] += i.ai_suggested_competency_id == i.mapped_competency_id
    for row in by_comp.values():
        row["accuracy_pct"] = round(row["matched"] / row["reviewed"] * 100, 1)

    by_action = {"accepted": 0, "reassigned": 0, "custom": 0}
    for i in reviewed:
        action = _override_action(i)
        if action in by_action:
            by_action[action] += 1

    accuracy = round(len(matched) / len(reviewed) * 100, 1) if reviewed else None
    return {
        "course_id": str(course_id),
        "target_pct": MAPPING_ACCURACY_TARGET,
        "ai_mapped_items": len(ai_items),
        "reviewed_items": len(reviewed),
        "matched_items": len(matched),
        "accuracy_pct": accuracy,
        "meets_target": accuracy is not None and accuracy >= MAPPING_ACCURACY_TARGET,
        "auto_accepted_unreviewed": sum(1 for i in ai_items if i.validated_by is None and not i.needs_review),
        "pending_review": sum(1 for i in ai_items if i.validated_by is None and i.needs_review),
        "by_action": by_action,
        "by_competency": sorted(by_comp.values(), key=lambda r: r["accuracy_pct"]),
    }


@router.put("/items/{item_id}/tag")
def override_tag(
    item_id: str,
    competency_id: str,
    background_tasks: BackgroundTasks,
    reason: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    item = _get_item_for_edit(item_id, db, current_user)
    competency = (
        db.query(Competency)
        .join(Competency.syllabus)
        .filter(Competency.id == _parse_uuid(competency_id, "competency_id"))
        .filter_by(course_id=item.assessment.course_id, status=SyllabusStatus.validated)
        .first()
    )
    if not competency:
        raise HTTPException(
            status_code=422,
            detail="Competency does not belong to this course's validated syllabus",
        )
    competency_id = competency.id
    previous_competency_id = item.mapped_competency_id
    item.mapped_competency_id = competency_id
    item.mapped_competency = competency
    item.needs_review = False
    item.validated_by = current_user.id
    db.query(StudentScore).filter(StudentScore.item_id == item.id).update(
        {"competency_id": competency_id},
        synchronize_session=False,
    )
    db.commit()
    action = _override_action(item)
    # Logged for the mapping-accuracy audit and prompt optimization (§3.6.2).
    log_action(db, str(current_user.id), "mapping_override", target_table="assessment_items",
               target_id=str(item.id), extra={
                   "override_action": action,
                   "previous_competency_id": str(previous_competency_id) if previous_competency_id else None,
                   "new_competency_id": str(competency_id),
                   "ai_suggested_competency_id": (
                       str(item.ai_suggested_competency_id) if item.ai_suggested_competency_id else None
                   ),
                   "ai_confidence": item.ai_confidence,
                   "reason": (reason or "").strip()[:500] or None,
                   "question_text": item.question_text[:300],
               })
    background_tasks.add_task(refresh_course_analytics, item.assessment.course_id, db)
    return {"status": "updated", "override_action": action}


@router.put("/items/{item_id}/revert")
def revert_item(
    item_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    item = _get_item_for_edit(item_id, db, current_user)
    item.needs_review = True
    item.validated_by = None
    db.commit()
    log_action(db, str(current_user.id), "mapping_revert", target_table="assessment_items",
               target_id=str(item.id), extra={
                   "competency_id": str(item.mapped_competency_id) if item.mapped_competency_id else None,
               })
    background_tasks.add_task(refresh_course_analytics, item.assessment.course_id, db)
    return {"status": "reverted"}


@router.put("/{assessment_id}/confirm-confident")
def confirm_confident_mappings(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    """Faculty confirm, in one action, every pending AI mapping of this assessment whose
    self-reported confidence is at or above the review threshold. The confirmation is
    recorded per item (validated_by) and audit-logged; low-confidence items stay queued."""
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    course = db.query(Course).filter(Course.id == assessment.course_id).first()
    _assert_course_access(course, current_user)
    threshold = get_settings(db).mapping_review_threshold
    items = db.query(AssessmentItem).filter(
        AssessmentItem.assessment_id == assessment_id,
        AssessmentItem.needs_review == True,  # noqa: E712
        AssessmentItem.validated_by.is_(None),
        AssessmentItem.mapped_competency_id.isnot(None),
        AssessmentItem.ai_suggested_competency_id.isnot(None),
        AssessmentItem.ai_confidence >= threshold,
    ).all()
    for item in items:
        item.needs_review = False
        item.validated_by = current_user.id
    db.commit()
    log_action(db, str(current_user.id), "mapping_bulk_confirm", target_table="assessments",
               target_id=str(assessment_id), extra={"confirmed": len(items), "threshold": threshold,
                                                    "item_ids": [str(i.id) for i in items][:500]})
    return {"confirmed": len(items), "threshold": threshold}
