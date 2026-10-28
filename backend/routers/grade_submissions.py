import uuid

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.core.access import assert_course_read_access
from backend.core.audit import log_action
from backend.core.database import get_db
from backend.core.deps import get_current_user, require_role
from backend.core.notifications import notify, notify_roles
from backend.models.user import User, UserRole
from backend.models.course import Course
from backend.models.grade_submission import GradeSubmission, GradeSubmissionApproval, GradeSubmissionStatus
from backend.schemas.grade_submission import (
    GradeSubmissionCreate, GradeSubmissionResponse,
    GradeSubmissionApprovalCreate, GradeSubmissionApprovalResponse, GradeSubmissionQueueItem,
)
from backend.models.assessment import Assessment
from backend.models.score import StudentScore
from backend.core.security import hash_student_id
from backend.models.grade_scale import GradeScale
from backend.services.grading import get_letter_grade

router = APIRouter(prefix="/grade-submissions", tags=["grade-submissions"])

APPROVAL_CHAIN = {
    UserRole.program_director: (GradeSubmissionStatus.pending_pd, GradeSubmissionStatus.pending_dean),
    UserRole.dean:             (GradeSubmissionStatus.pending_dean, GradeSubmissionStatus.pending_vp),
    UserRole.vp_academic_affairs: (GradeSubmissionStatus.pending_vp, GradeSubmissionStatus.posted),
}
APPROVER_ROLES = {UserRole.program_director, UserRole.dean, UserRole.vp_academic_affairs}


def _assert_instructor_access(submission: GradeSubmission, current_user: User):
    if current_user.role == UserRole.admin:
        return
    if str(submission.instructor_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="You do not own this grade submission")


ROLE_LABELS = {"program_director": "Program Director", "dean": "Dean", "vp_academic_affairs": "VP for Academic Affairs"}


def _queue_item(sub: GradeSubmission, db: Session, passing: float) -> GradeSubmissionQueueItem:
    """What the approver signs off: the course, its instructor, the period's results, earlier sign-offs."""
    course, instructor = sub.course, sub.instructor
    period = getattr(sub.grading_period, "value", sub.grading_period)
    assessments = (db.query(Assessment)
                   .filter(Assessment.course_id == sub.course_id, Assessment.grading_period == period)
                   .order_by(Assessment.date, Assessment.title).all())
    per_student: dict = {}
    rows = []
    for a in assessments:
        by_student: dict = {}
        for sc in db.query(StudentScore).filter(StudentScore.assessment_id == a.id).all():
            pct = sc.score / sc.max_score * 100 if sc.max_score else 0.0
            by_student.setdefault(sc.student_id_hash, []).append(pct)
            per_student.setdefault(sc.student_id_hash, []).append(pct)
        avgs = [sum(v) / len(v) for v in by_student.values()]
        rows.append({"title": a.title, "type": getattr(a.type, "value", a.type),
                     "approval_status": getattr(a.approval_status, "value", a.approval_status),
                     "students": len(avgs), "average": round(sum(avgs) / len(avgs), 1) if avgs else None})
    student_avgs = [sum(v) / len(v) for v in per_student.values()]
    # The grade sheet itself, read-only: who got what, as the official BTECH grade.
    students = db.query(User).filter(User.role == UserRole.student, User.student_number.isnot(None)).all()
    by_hash = {hash_student_id(u.student_number): u for u in students}
    grades = []
    for sid_hash, v in per_student.items():
        pct = sum(v) / len(v)
        u = by_hash.get(sid_hash)
        grade = get_letter_grade(pct, db)
        grades.append({"name": u.full_name if u else "Unlinked student record",
                       "student_number": u.student_number if u else None,
                       "percent": round(pct, 2), "grade": grade, "passed": pct >= passing})
    grades.sort(key=lambda g: g["name"].lower())
    approvals = []
    for ap in sorted(sub.approvals, key=lambda x: x.reviewed_at or datetime.min.replace(tzinfo=timezone.utc)):
        who = db.get(User, ap.approver_id)
        approvals.append({"role": ROLE_LABELS.get(ap.role, ap.role), "status": ap.status,
                          "approver_name": who.full_name if who else None, "feedback": ap.feedback,
                          "reviewed_at": ap.reviewed_at.isoformat() if ap.reviewed_at else None})
    return GradeSubmissionQueueItem(
        **GradeSubmissionResponse.model_validate(sub).model_dump(),
        course_code=course.code if course else None,
        course_title=course.title if course else None,
        course_academic_period=course.academic_period if course else None,
        instructor_name=instructor.full_name if instructor else None,
        passing_threshold=passing,
        students=len(student_avgs),
        class_average=round(sum(student_avgs) / len(student_avgs), 1) if student_avgs else None,
        below_passing=sum(1 for v in student_avgs if v < passing),
        grades=grades,
        assessments=rows,
        approvals=approvals,
    )


@router.get("/pending", response_model=list[GradeSubmissionQueueItem])
def get_pending_submissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Only approvers can view the grade submission queue")
    required_stage, _ = APPROVAL_CHAIN[current_user.role]

    # Passing comes from the grade scale (lowest bracket above 5.00), not the competency-mastery setting.
    lowest_pass = (db.query(GradeScale).filter(GradeScale.grade_points < 5)
                   .order_by(GradeScale.min_percent).first())
    passing = lowest_pass.min_percent if lowest_pass else 75.0
    if current_user.role == UserRole.vp_academic_affairs:
        subs = db.query(GradeSubmission).filter(GradeSubmission.status == required_stage).all()
        return [_queue_item(x, db, passing) for x in subs]

    if not current_user.college:
        raise HTTPException(status_code=403, detail="Your account has no college assigned. Contact an administrator.")

    subs = (
        db.query(GradeSubmission)
        .join(User, GradeSubmission.instructor_id == User.id)
        .filter(
            GradeSubmission.status == required_stage,
            User.college == current_user.college,
        )
        .all()
    )
    return [_queue_item(x, db, passing) for x in subs]


@router.get("/mine", response_model=list[GradeSubmissionResponse])
def get_my_submissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    return (
        db.query(GradeSubmission)
        .filter(GradeSubmission.instructor_id == current_user.id)
        .order_by(GradeSubmission.created_at.desc())
        .all()
    )


@router.post("/", response_model=GradeSubmissionResponse, status_code=status.HTTP_201_CREATED)
def create_grade_submission(
    payload: GradeSubmissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    course = db.query(Course).filter(Course.id == str(payload.course_id)).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if current_user.role != UserRole.admin and str(course.instructor_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="You do not own this course")

    submission = GradeSubmission(
        course_id=str(payload.course_id),
        instructor_id=current_user.id,
        grading_period=payload.grading_period,
        notes=payload.notes,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    log_action(db, str(current_user.id), "create_grade_submission", target_table="grade_submissions",
               target_id=str(submission.id), extra={"course_id": str(payload.course_id)})
    return submission


@router.post("/{submission_id}/submit-to-pd", response_model=GradeSubmissionResponse)
def submit_to_pd(
    submission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    submission = db.query(GradeSubmission).filter(GradeSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Grade submission not found")
    if submission.status not in (GradeSubmissionStatus.draft, GradeSubmissionStatus.rejected):
        raise HTTPException(status_code=400, detail=f"Cannot submit from status '{submission.status}'")
    _assert_instructor_access(submission, current_user)
    submission.status = GradeSubmissionStatus.pending_pd
    submission.submitted_at = datetime.now(timezone.utc)
    notify_roles(db, [UserRole.program_director], current_user.college,
                 "grade_submission_submitted", "Grade Submission Pending Review",
                 f"A grade submission for {submission.grading_period} has been submitted by {current_user.full_name}.",
                 related_id=submission_id)
    db.commit()
    db.refresh(submission)
    log_action(db, str(current_user.id), "submit_grade_submission_to_pd", target_table="grade_submissions", target_id=submission_id)
    return submission


@router.post("/{submission_id}/approve", response_model=GradeSubmissionResponse)
def approve_submission(
    submission_id: str,
    payload: GradeSubmissionApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Only approvers can approve grade submissions")
    submission = db.query(GradeSubmission).filter(GradeSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Grade submission not found")
    required_stage, next_stage = APPROVAL_CHAIN[current_user.role]
    if submission.status != required_stage:
        raise HTTPException(status_code=400, detail=f"Your role can only approve submissions in '{required_stage}' stage")
    approval = GradeSubmissionApproval(
        submission_id=submission.id,
        approver_id=current_user.id,
        role=current_user.role.value,
        status="approved",
        feedback=payload.feedback,
    )
    db.add(approval)
    submission.status = next_stage
    if next_stage == GradeSubmissionStatus.posted:
        submission.posted_at = datetime.now(timezone.utc)
        notify(db, str(submission.instructor_id), "grade_submission_posted",
               "Grades Officially Posted",
               f"Your {submission.grading_period} grade submission has been officially posted.",
               related_id=submission_id)
    else:
        notify(db, str(submission.instructor_id), "grade_submission_approved",
               "Grade Submission Advancing",
               f"Your {submission.grading_period} grade submission was approved by the {current_user.role.value.replace('_', ' ').title()} and is advancing.",
               related_id=submission_id)
        # Notify next approver in chain
        instructor = db.query(User).filter(User.id == submission.instructor_id).first()
        college = instructor.college if instructor else None
        if next_stage == GradeSubmissionStatus.pending_dean:
            notify_roles(db, [UserRole.dean], college,
                         "grade_submission_submitted", "Grade Submission Pending Endorsement",
                         "A grade submission is ready for your endorsement.", related_id=submission_id)
        elif next_stage == GradeSubmissionStatus.pending_vp:
            notify_roles(db, [UserRole.vp_academic_affairs], None,
                         "grade_submission_submitted", "Grade Submission Pending Authorization",
                         "A grade submission is ready for your posting authorization.", related_id=submission_id)
    db.commit()
    db.refresh(submission)
    log_action(db, str(current_user.id), "approve_grade_submission", target_table="grade_submissions",
               target_id=submission_id, extra={"next_stage": next_stage.value})
    return submission


@router.post("/{submission_id}/reject", response_model=GradeSubmissionResponse)
def reject_submission(
    submission_id: str,
    payload: GradeSubmissionApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Only approvers can reject grade submissions")
    submission = db.query(GradeSubmission).filter(GradeSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Grade submission not found")
    required_stage, _ = APPROVAL_CHAIN[current_user.role]
    if submission.status != required_stage:
        raise HTTPException(status_code=400, detail=f"Your role can only act on submissions in '{required_stage}' stage")
    approval = GradeSubmissionApproval(
        submission_id=submission.id,
        approver_id=current_user.id,
        role=current_user.role.value,
        status="rejected",
        feedback=payload.feedback,
    )
    db.add(approval)
    submission.status = GradeSubmissionStatus.rejected
    notify(db, str(submission.instructor_id), "grade_submission_rejected",
           "Grade Submission Rejected",
           f"Your {submission.grading_period} grade submission was rejected. Reason: {payload.feedback or 'No reason provided.'}",
           related_id=submission_id)
    db.commit()
    db.refresh(submission)
    log_action(db, str(current_user.id), "reject_grade_submission", target_table="grade_submissions",
               target_id=submission_id, extra={"feedback": payload.feedback})
    return submission


@router.get("/{submission_id}", response_model=GradeSubmissionResponse)
def get_submission(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    submission = db.query(GradeSubmission).filter(GradeSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Grade submission not found")
    assert_course_read_access(submission.instructor_id, current_user, db)
    return submission


@router.get("/{submission_id}/approval-history", response_model=list[GradeSubmissionApprovalResponse])
def get_submission_approval_history(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    submission = db.query(GradeSubmission).filter(GradeSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Grade submission not found")
    assert_course_read_access(submission.instructor_id, current_user, db)
    return (
        db.query(GradeSubmissionApproval)
        .filter(GradeSubmissionApproval.submission_id == submission_id)
        .order_by(GradeSubmissionApproval.reviewed_at)
        .all()
    )
