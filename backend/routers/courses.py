from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.deps import get_current_user, require_role
from backend.models.user import User, UserRole
from backend.models.course import Course
from backend.models.grade_weight import GradeWeight
from backend.schemas.course import CourseCreate, CourseResponse
from backend.schemas.grade_weight import GradeWeightCreate, GradeWeightResponse

router = APIRouter(prefix="/courses", tags=["courses"])


def _owned_course(course_id, db: Session, current_user: User) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if current_user.role != UserRole.admin and str(course.instructor_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="You do not own this course")
    return course


@router.post("/", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create_course(
    payload: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    norm = lambda col: func.upper(func.replace(col, " ", ""))
    duplicate = db.query(Course).filter(
        norm(Course.code) == payload.code.replace(" ", "").upper(),
        norm(Course.academic_period) == payload.academic_period.replace(" ", "").upper(),
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{duplicate.code} already exists for {duplicate.academic_period}. "
                   "Open it from My Syllabi instead of creating it again.",
        )
    course = Course(**payload.model_dump(), instructor_id=current_user.id)
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.get("/", response_model=list[CourseResponse])
def list_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.admin:
        return db.query(Course).all()
    return db.query(Course).filter(Course.instructor_id == current_user.id).all()


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.get("/{course_id}/grade-weights", response_model=list[GradeWeightResponse])
def list_grade_weights(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _owned_course(course_id, db, current_user)
    return db.query(GradeWeight).filter(GradeWeight.course_id == course_id).all()


@router.post("/{course_id}/grade-weights", response_model=GradeWeightResponse, status_code=status.HTTP_201_CREATED)
def upsert_grade_weight(
    course_id: str,
    payload: GradeWeightCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _owned_course(course_id, db, current_user)
    existing = db.query(GradeWeight).filter(
        GradeWeight.course_id == course_id,
        GradeWeight.grading_period == payload.grading_period,
        GradeWeight.assessment_category == payload.assessment_category,
    ).first()
    if existing:
        existing.weight_percent = payload.weight_percent
        db.commit()
        db.refresh(existing)
        return existing
    weight = GradeWeight(course_id=course_id, **payload.model_dump())
    db.add(weight)
    db.commit()
    db.refresh(weight)
    return weight


@router.delete("/{course_id}/grade-weights", status_code=status.HTTP_204_NO_CONTENT)
def clear_grade_weights(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.instructor, UserRole.admin)),
):
    _owned_course(course_id, db, current_user)
    db.query(GradeWeight).filter(GradeWeight.course_id == course_id).delete()
    db.commit()
