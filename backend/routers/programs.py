from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.deps import require_role, get_current_user
from backend.models.user import User, UserRole
from backend.models.program import Program
from backend.schemas.curriculum import ProgramCreate, ProgramResponse

router = APIRouter(prefix="/programs", tags=["programs"])


@router.post("/", response_model=ProgramResponse, status_code=status.HTTP_201_CREATED)
def create_program(
    payload: ProgramCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    program = Program(**payload.model_dump())
    db.add(program)
    db.commit()
    db.refresh(program)
    return program


@router.get("/", response_model=list[ProgramResponse])
def list_programs(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(Program).all()


@router.get("/{program_id}", response_model=ProgramResponse)
def get_program(
    program_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    return program


@router.put("/{program_id}", response_model=ProgramResponse)
def update_program(
    program_id: str,
    payload: ProgramCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    for field, value in payload.model_dump().items():
        setattr(program, field, value)
    db.commit()
    db.refresh(program)
    return program


@router.delete("/{program_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_program(
    program_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    # Curricula hold subjects, sections and enrollments; deleting them would fail (500) or lose data.
    if program.curricula:
        names = ", ".join(c.name for c in program.curricula)
        raise HTTPException(
            status_code=409,
            detail=(f"{program.program_name} still has {len(program.curricula)} "
                    f"{'curriculum' if len(program.curricula) == 1 else 'curricula'} ({names}). "
                    "A program with curricula cannot be deleted; set its curricula to inactive or archived instead."),
        )
    db.delete(program)
    db.commit()
