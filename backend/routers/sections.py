from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.deps import require_role, get_current_user
from backend.models.user import User, UserRole
from backend.models.section import Section
from backend.schemas.curriculum import SectionCreate, SectionResponse

router = APIRouter(prefix="/sections", tags=["sections"])


@router.post("/", response_model=SectionResponse, status_code=status.HTTP_201_CREATED)
def create_section(
    payload: SectionCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    section = Section(**payload.model_dump())
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


@router.get("/", response_model=list[SectionResponse])
def list_sections(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(Section).all()


@router.get("/{section_id}", response_model=SectionResponse)
def get_section(
    section_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    section = db.query(Section).filter(Section.id == section_id).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    return section


@router.put("/{section_id}", response_model=SectionResponse)
def update_section(
    section_id: str,
    payload: SectionCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    section = db.query(Section).filter(Section.id == section_id).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    for field, value in payload.model_dump().items():
        setattr(section, field, value)
    db.commit()
    db.refresh(section)
    return section


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(
    section_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    section = db.query(Section).filter(Section.id == section_id).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    # Deleting would orphan enrollments (NOT NULL FK -> 500) or silently unlink courses.
    from backend.models.course import Course
    n_students = len(section.enrollments)
    n_courses = db.query(Course).filter(Course.section_id == section.id).count()
    if n_students or n_courses:
        raise HTTPException(
            status_code=409,
            detail=(f"Section {section.section_name} still has {n_students} enrolled student(s) and "
                    f"{n_courses} course(s). Remove those enrollments and move the courses first."),
        )
    db.delete(section)
    db.commit()
