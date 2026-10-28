from sqlalchemy.orm import Session
from backend.models.grade_scale import GradeScale


def _bracket(score_percent: float, db: Session):
    """The grade-scale row this percentage has reached. Brackets are whole numbers (75, 76-78, ...),
    so a percentage like 75.33 belongs to the highest bracket whose minimum it meets."""
    return (
        db.query(GradeScale)
        .filter(GradeScale.min_percent <= score_percent)
        .order_by(GradeScale.min_percent.desc())
        .first()
    )


def get_letter_grade(score_percent: float, db: Session) -> str:
    """Convert a percentage score to a BTECH numeric grade (1.00–5.00 scale)."""
    scale = _bracket(score_percent, db)
    if scale:
        return scale.letter_grade
    return "5.00" if score_percent < 75 else "1.00"


def get_grade_points(score_percent: float, db: Session) -> float:
    scale = _bracket(score_percent, db)
    return scale.grade_points if scale else (5.00 if score_percent < 75 else 1.00)
