"""
Advisory TOS / Bloom alignment hints for assessment review (capstone §3.11.2).
"""
import uuid

import pytest

from backend.core.security import create_access_token, hash_password
from backend.models.assessment import Assessment, AssessmentType, GradingPeriod
from backend.models.course import Course
from backend.models.exam_question import ExamQuestion
from backend.models.syllabus import Competency, Syllabus, SyllabusStatus
from backend.models.tos import TableOfSpecifications
from backend.models.user import User, UserRole


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def exam(db, instructor_user):
    course = Course(title="Data Structures", code="ITC 212", academic_period="AY 2025-2026 S1",
                    instructor_id=instructor_user.id)
    db.add(course)
    db.flush()
    syl = Syllabus(course_id=course.id, file_path="x", status=SyllabusStatus.validated)
    db.add(syl)
    db.flush()
    c1 = Competency(syllabus_id=syl.id, competency_code="DSA-01", topic_name="Analysis", learning_outcomes=[])
    c2 = Competency(syllabus_id=syl.id, competency_code="DSA-02", topic_name="Lists", learning_outcomes=[])
    c3 = Competency(syllabus_id=syl.id, competency_code="DSA-03", topic_name="Trees", learning_outcomes=[])
    db.add_all([c1, c2, c3])
    a = Assessment(course_id=course.id, title="Midterm", type=AssessmentType.exam, grading_period=GradingPeriod.midterm)
    db.add(a)
    db.flush()
    db.add_all([
        TableOfSpecifications(assessment_id=a.id, competency_id=c1.id, bloom_level="Remembering", item_count=2),
        TableOfSpecifications(assessment_id=a.id, competency_id=c2.id, bloom_level="Applying", item_count=2),
    ])
    db.add_all([
        ExamQuestion(assessment_id=a.id, competency_id=c1.id, question_text="Q1", bloom_level="Evaluating", order_index=0),
        ExamQuestion(assessment_id=a.id, competency_id=c2.id, question_text="Q2", bloom_level="Applying", order_index=1),
        ExamQuestion(assessment_id=a.id, competency_id=c3.id, question_text="Q3", bloom_level="Applying", order_index=2),
        ExamQuestion(assessment_id=a.id, competency_id=None, question_text="Q4", bloom_level=None, order_index=3),
    ])
    db.commit()
    return a


def test_hints_flag_misalignment(client, instructor_token, exam):
    body = client.get(f"/assessments/{exam.id}/alignment-hints", headers=_auth(instructor_token)).json()
    kinds = {(h["kind"], h["question_number"]) for h in body["hints"]}
    assert ("bloom_mismatch", 1) in kinds       # Evaluating vs planned Remembering
    assert ("outside_tos", 3) in kinds          # DSA-03 not in TOS
    assert ("unlinked", 4) in kinds
    assert ("under_covered", None) in kinds     # DSA-01 and DSA-02 each planned 2, have 1
    assert ("difficulty", None) in kinds        # 25% Evaluating vs 0% planned
    assert body["advisory"] is True
    assert body["warnings"] == sum(1 for h in body["hints"] if h["severity"] == "warning")


def test_program_director_of_same_college_can_view(client, db, exam):
    pd = User(email="pd@test.com", password_hash=hash_password("x"), full_name="PD",
              role=UserRole.program_director, is_active=True, college="ICS")
    other = User(email="pd2@test.com", password_hash=hash_password("x"), full_name="PD2",
                 role=UserRole.program_director, is_active=True, college="CBA")
    db.add_all([pd, other])
    db.commit()

    def tok(u):
        return create_access_token({"sub": str(u.id), "role": u.role, "jti": str(uuid.uuid4())})
    assert client.get(f"/assessments/{exam.id}/alignment-hints", headers=_auth(tok(pd))).status_code == 200
    assert client.get(f"/assessments/{exam.id}/alignment-hints", headers=_auth(tok(other))).status_code == 403


def test_student_cannot_view(client, student_token, exam):
    assert client.get(f"/assessments/{exam.id}/alignment-hints", headers=_auth(student_token)).status_code == 403


def test_program_director_reads_but_cannot_edit_exam_questions(client, db, exam):
    pd = User(email="pd@test.com", password_hash=hash_password("x"), full_name="PD",
              role=UserRole.program_director, is_active=True, college="ICS")
    db.add(pd)
    db.commit()
    headers = _auth(create_access_token({"sub": str(pd.id), "role": pd.role, "jti": str(uuid.uuid4())}))
    assert client.get(f"/assessments/{exam.id}/questions", headers=headers).status_code == 200
    body = {"question_text": "Changed by PD", "question_type": "short_answer", "points": 1}
    assert client.post(f"/assessments/{exam.id}/questions", headers=headers, json=body).status_code == 403

    vp = User(email="vp@test.com", password_hash=hash_password("x"), full_name="VP",
              role=UserRole.vp_academic_affairs, is_active=True)
    db.add(vp)
    db.commit()
    vp_headers = _auth(create_access_token({"sub": str(vp.id), "role": vp.role, "jti": str(uuid.uuid4())}))
    assert client.get(f"/assessments/{exam.id}/questions", headers=vp_headers).status_code == 403
