"""Exam questions drafted from the validated syllabus, exported as a printable exam,
answer key, and pre-tagged score sheet. Students answer outside AILAS; scores come
back through the regular CSV upload."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from backend.core.access import assert_course_read_access
from backend.core.audit import log_action
from backend.core.database import get_db
from backend.core.deps import require_role
from backend.core.security import hash_student_id
from backend.models.assessment import Assessment
from backend.models.course import Course
from backend.models.enrollment import StudentEnrollment
from backend.models.exam_question import ExamQuestion
from backend.models.score import StudentScore
from backend.models.syllabus import Competency, Syllabus, SyllabusStatus
from backend.models.tos import TableOfSpecifications
from backend.models.user import User, UserRole
from backend.routers.assessments import _assert_course_access
from backend.schemas.exam_question import ExamQuestionCreate, ExamQuestionUpdate, GenerateQuestionsRequest
from backend.services.ai.question_generator import DEFAULT_POINTS, generate_questions
from backend.services.assessment.exam_exporter import PERIOD_LABELS, build_exam_docx, build_score_sheet_csv

router = APIRouter(tags=["exam-questions"])

MAX_QUESTIONS = 60
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_instructor = require_role(UserRole.instructor, UserRole.admin)


def _load_assessment(assessment_id, db: Session, user: User) -> tuple[Assessment, Course]:
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    course = db.query(Course).filter(Course.id == assessment.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_access(course, user)
    return assessment, course


def _is_locked(assessment_id, db: Session) -> bool:
    """Once scores are uploaded, question text is the join key to the score rows."""
    return db.query(StudentScore.id).filter(StudentScore.assessment_id == assessment_id).first() is not None


def _assert_unlocked(assessment_id, db: Session):
    if _is_locked(assessment_id, db):
        raise HTTPException(
            status_code=409,
            detail="Scores have already been uploaded for this assessment, so its questions can no longer be changed.",
        )


def _course_competencies(course_id, db: Session) -> list[Competency]:
    syllabus = (
        db.query(Syllabus)
        .filter(Syllabus.course_id == course_id, Syllabus.status == SyllabusStatus.validated)
        .first()
    )
    if not syllabus:
        return []
    return db.query(Competency).filter(Competency.syllabus_id == syllabus.id).all()


def _ordered(assessment_id, db: Session) -> list[ExamQuestion]:
    return (
        db.query(ExamQuestion)
        .filter(ExamQuestion.assessment_id == assessment_id)
        .order_by(ExamQuestion.order_index, ExamQuestion.created_at)
        .all()
    )


def _serialize(q: ExamQuestion) -> dict:
    return {
        "id": str(q.id),
        "assessment_id": str(q.assessment_id),
        "competency_id": str(q.competency_id) if q.competency_id else None,
        "competency_code": q.competency.competency_code if q.competency else None,
        "topic_name": q.competency.topic_name if q.competency else None,
        "question_text": q.question_text,
        "question_type": q.question_type,
        "choices": q.choices,
        "answer_key": q.answer_key,
        "points": q.points,
        "bloom_level": q.bloom_level,
        "order_index": q.order_index,
        "source": q.source,
    }


def _listing(assessment_id, db: Session, **extra) -> dict:
    return {"locked": _is_locked(assessment_id, db),
            "questions": [_serialize(q) for q in _ordered(assessment_id, db)], **extra}


def _check_competency(competency_id, course_id, db: Session):
    if competency_id and str(competency_id) not in {str(c.id) for c in _course_competencies(course_id, db)}:
        raise HTTPException(status_code=422, detail="Competency does not belong to this course's validated syllabus")


def _check_choices(question_type: str, choices):
    if question_type == "multiple_choice" and (not choices or len([c for c in choices if c.strip()]) < 2):
        raise HTTPException(status_code=422, detail="Multiple-choice questions need at least 2 choices")


# Per BTECH policy only the PD and Dean may read an exam (never change it).
_REVIEWERS = (UserRole.program_director, UserRole.dean)


@router.get("/assessments/{assessment_id}/questions")
def list_questions(assessment_id: uuid.UUID, db: Session = Depends(get_db),
                   current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin, *_REVIEWERS))):
    if current_user.role in _REVIEWERS:
        # Read-only: the approver must see the questions they are signing off.
        assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
        if not assessment:
            raise HTTPException(status_code=404, detail="Assessment not found")
        assert_course_read_access(assessment.course.instructor_id, current_user, db)
    else:
        _load_assessment(assessment_id, db, current_user)
    return _listing(assessment_id, db)


@router.post("/assessments/{assessment_id}/questions/generate")
def generate(
    assessment_id: uuid.UUID,
    payload: GenerateQuestionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_instructor),
):
    assessment, course = _load_assessment(assessment_id, db, current_user)
    _assert_unlocked(assessment_id, db)

    competencies = _course_competencies(course.id, db)
    if not competencies:
        raise HTTPException(status_code=422, detail="This course has no validated syllabus to generate questions from.")
    by_id = {str(c.id): c for c in competencies}

    def as_dict(c: Competency) -> dict:
        return {"competency_code": c.competency_code, "topic_name": c.topic_name,
                "learning_outcomes": c.learning_outcomes or []}

    tos = []
    if payload.use_tos:
        tos = [t for t in db.query(TableOfSpecifications)
               .filter(TableOfSpecifications.assessment_id == assessment_id).all()
               if t.item_count > 0 and str(t.competency_id) in by_id]
    if tos:
        plan = [{"competency": as_dict(by_id[str(t.competency_id)]), "count": t.item_count,
                 "bloom_level": t.bloom_level} for t in tos]
        basis = "tos"
    else:
        selected = [by_id[str(i)] for i in payload.competency_ids if str(i) in by_id] \
            if payload.competency_ids else competencies
        if not selected:
            raise HTTPException(status_code=422, detail="Select at least one competency from this course.")
        plan = [{"competency": as_dict(c), "count": payload.count_per_competency, "bloom_level": None}
                for c in sorted(selected, key=lambda c: c.competency_code)]
        basis = "competencies"

    if sum(p["count"] for p in plan) > MAX_QUESTIONS:
        raise HTTPException(status_code=422, detail=f"That would create more than {MAX_QUESTIONS} questions. "
                                                    "Lower the count or select fewer competencies.")

    drafted, source = generate_questions(
        plan, payload.question_type, course=f"{course.code} {course.title}",
        period=PERIOD_LABELS.get(getattr(assessment.grading_period, "value", ""), ""),
    )
    if not drafted:
        raise HTTPException(status_code=502, detail="No questions could be generated. Try again.")

    if payload.replace:
        db.query(ExamQuestion).filter(ExamQuestion.assessment_id == assessment_id).delete()
        start = 0
    else:
        start = len(_ordered(assessment_id, db))

    comp_by_code = {c.competency_code.strip().upper(): c for c in competencies}
    for i, q in enumerate(drafted):
        db.add(ExamQuestion(
            assessment_id=assessment_id,
            competency_id=comp_by_code[q["competency_code"]].id,
            question_text=q["question_text"],
            question_type=q["question_type"],
            choices=q["choices"],
            answer_key=q["answer_key"],
            points=q["points"],
            bloom_level=q["bloom_level"],
            order_index=start + i,
            source=source,
        ))
    db.commit()
    log_action(db, str(current_user.id), "generate_exam_questions", target_table="assessments",
               target_id=str(assessment_id), extra={"count": len(drafted), "source": source, "basis": basis})
    return _listing(assessment_id, db, source=source, basis=basis)


@router.post("/assessments/{assessment_id}/questions", status_code=status.HTTP_201_CREATED)
def add_question(
    assessment_id: uuid.UUID,
    payload: ExamQuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_instructor),
):
    _, course = _load_assessment(assessment_id, db, current_user)
    _assert_unlocked(assessment_id, db)
    _check_competency(payload.competency_id, course.id, db)
    _check_choices(payload.question_type, payload.choices)
    q = ExamQuestion(
        assessment_id=assessment_id,
        order_index=len(_ordered(assessment_id, db)),
        source="manual",
        **{**payload.model_dump(), "choices": payload.choices if payload.question_type == "multiple_choice" else None},
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return _serialize(q)


@router.put("/assessments/questions/{question_id}")
def update_question(
    question_id: uuid.UUID,
    payload: ExamQuestionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_instructor),
):
    q = db.query(ExamQuestion).filter(ExamQuestion.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    _, course = _load_assessment(q.assessment_id, db, current_user)
    _assert_unlocked(q.assessment_id, db)
    changes = payload.model_dump(exclude_unset=True)
    if "competency_id" in changes:
        _check_competency(changes["competency_id"], course.id, db)
    qtype = changes.get("question_type", q.question_type)
    _check_choices(qtype, changes.get("choices", q.choices))
    for key, value in changes.items():
        setattr(q, key, value)
    if qtype != "multiple_choice":
        q.choices = None
    db.commit()
    db.refresh(q)
    return _serialize(q)


@router.delete("/assessments/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(question_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(_instructor)):
    q = db.query(ExamQuestion).filter(ExamQuestion.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    _load_assessment(q.assessment_id, db, current_user)
    _assert_unlocked(q.assessment_id, db)
    db.delete(q)
    db.commit()


def _require_questions(assessment_id, db: Session) -> list[ExamQuestion]:
    questions = _ordered(assessment_id, db)
    if not questions:
        raise HTTPException(status_code=422, detail="This assessment has no questions yet.")
    return questions


def _filename(course: Course, assessment: Assessment, suffix: str) -> str:
    stem = f"{course.code}_{assessment.title}_{suffix}"
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in stem)


@router.get("/assessments/{assessment_id}/questions/export/docx")
def export_docx(
    assessment_id: uuid.UUID,
    answer_key: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(_instructor),
):
    assessment, course = _load_assessment(assessment_id, db, current_user)
    questions = _require_questions(assessment_id, db)
    content = build_exam_docx(course, assessment, questions, with_answers=answer_key)
    name = _filename(course, assessment, "Answer_Key" if answer_key else "Exam") + ".docx"
    return Response(content=content, media_type=DOCX_MIME,
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/assessments/{assessment_id}/questions/export/score-sheet")
def export_score_sheet(assessment_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(_instructor)):
    assessment, course = _load_assessment(assessment_id, db, current_user)
    questions = _require_questions(assessment_id, db)

    # Roster: students enrolled in the course's section, plus anyone who already has scores in the course
    hashes = set()
    if course.section_id:
        hashes |= {e.student_id_hash for e in db.query(StudentEnrollment)
                   .filter(StudentEnrollment.section_id == course.section_id).all()}
    hashes |= {r[0] for r in db.query(StudentScore.student_id_hash)
               .join(Assessment, Assessment.id == StudentScore.assessment_id)
               .filter(Assessment.course_id == course.id).distinct().all()}
    students = [u for u in db.query(User).filter(User.role == UserRole.student, User.student_number.isnot(None)).all()
                if hash_student_id(u.student_number) in hashes]
    student_numbers = [u.student_number for u in sorted(students, key=lambda u: u.full_name)]

    # Same order as the printed exam (by part), so rows follow the paper
    part_order = {"multiple_choice": 0, "short_answer": 1, "problem": 2}
    questions = sorted(questions, key=lambda q: part_order.get(q.question_type, 9))
    date = assessment.date.date().isoformat() if assessment.date else ""
    content = build_score_sheet_csv(questions, student_numbers, date)
    name = _filename(course, assessment, "Score_Sheet") + ".csv"
    return Response(content=content, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
