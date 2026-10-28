"""Grade approval shows approvers the grade sheet (read-only, official BTECH grade), and the
grade scale maps fractional percentages to the bracket they reached."""
import uuid

from backend.core.security import create_access_token, hash_password, hash_student_id
from backend.models.assessment import Assessment, AssessmentType, GradingPeriod
from backend.models.course import Course
from backend.models.grade_scale import GradeScale
from backend.models.grade_submission import GradeSubmission, GradeSubmissionStatus
from backend.models.score import StudentScore
from backend.models.user import User, UserRole
from backend.services.grading import get_letter_grade

SCALE = [("5.00", 0, 74, 5), ("3.00", 75, 75, 3), ("2.75", 76, 78, 2.75), ("2.00", 85, 87, 2),
         ("1.25", 94, 96, 1.25), ("1.00", 97, 100, 1)]


def _scale(db):
    db.add_all([GradeScale(letter_grade=g, min_percent=lo, max_percent=hi, grade_points=p) for g, lo, hi, p in SCALE])
    db.commit()


def test_fractional_percentages_fall_in_the_bracket_they_reached(db):
    _scale(db)
    assert get_letter_grade(74.9, db) == "5.00"
    assert get_letter_grade(75.33, db) == "3.00"   # used to come out as 1.00
    assert get_letter_grade(78.6, db) == "2.75"
    assert get_letter_grade(96.5, db) == "1.25"


def test_pd_sees_grade_sheet_with_names_and_official_grades(client, db, instructor_user):
    _scale(db)
    students = [User(email=f"s{i}@test.com", password_hash=hash_password("x"), full_name=n, role=UserRole.student,
                     is_active=True, student_number=f"2024-000{i}") for i, n in ((1, "Ana Cruz"), (2, "Ben Diaz"))]
    pd = User(email="pd@test.com", password_hash=hash_password("x"), full_name="PD",
              role=UserRole.program_director, is_active=True, college="ICS")
    db.add_all(students + [pd])
    course = Course(title="DSA", code="ITC 212", academic_period="AY 2026", instructor_id=instructor_user.id)
    db.add(course)
    db.flush()
    exam = Assessment(course_id=course.id, title="Prelim Exam", type=AssessmentType.exam,
                      grading_period=GradingPeriod.prelim)
    db.add(exam)
    db.flush()
    for s, score in ((students[0], 86), (students[1], 60)):
        db.add(StudentScore(student_id_hash=hash_student_id(s.student_number), assessment_id=exam.id,
                            grading_period=GradingPeriod.prelim, score=score, max_score=100))
    db.add(GradeSubmission(course_id=course.id, instructor_id=instructor_user.id,
                           grading_period=GradingPeriod.prelim, status=GradeSubmissionStatus.pending_pd))
    db.commit()

    token = create_access_token({"sub": str(pd.id), "role": pd.role, "jti": str(uuid.uuid4())})
    r = client.get("/grade-submissions/pending", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    item = r.json()[0]
    assert [(g["name"], g["grade"], g["passed"]) for g in item["grades"]] == [
        ("Ana Cruz", "2.00", True), ("Ben Diaz", "5.00", False)]
    assert item["below_passing"] == 1
    assert item["assessments"][0]["approval_status"] != "approved"  # drives the "not reviewed" warning
