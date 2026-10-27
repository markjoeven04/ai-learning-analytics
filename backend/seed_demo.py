"""
Demo seed v2 — AILAS capstone defense (BTECH edition).

Institution: Dalubhasaang Politekniko ng Lungsod ng Baliwag (BTECH).
Academic units (inferred, PLACEHOLDER — confirm with proponent):
  - ICS  : Institute of Computer Studies (BSIT, BSCS)
  - CBA  : College of Business and Accountancy (BS Accountancy, BSBA)
  - CoEd : College of Education (BEEd, BSEd)

Full data refresh:
  - 2 new instructors (CBA, CoEd), 2 new PDs (ICS, CBA), 2 new deans (ICS, CBA)
  - andrea.reyes retained — updated to CBA / 3rd Year / BSA
  - 9 new students across CBA, ICS, CoEd colleges
  - 3 new programs (BSA, BSIT, BEEd) → curricula → sections
  - 4 new courses with full competency/assessment/score data

Risk distribution:
  - Excelling : Andrea Reyes, Pia Garcia, Liza Navarro
  - On-Track  : Mark Tolentino, Grace Villanueva, Ryan Mercado, Jose Santos
  - At-Risk   : Dante Cruz (declining), Felix Ramos (low)
  - No data   : Nina Reyes (BSBA student, no enrolled course)

Usage (from repo root):
    .\\backend\\venv\\Scripts\\Activate.ps1
    python -m backend.seed_demo
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import text
from backend.core.database import SessionLocal
from backend.core.security import hash_password, hash_student_id
from backend.models.user import User, UserRole
from backend.models.course import Course
from backend.models.syllabus import ApprovalStage, Syllabus, SyllabusStatus, Competency
from backend.models.assessment import Assessment, AssessmentItem, AssessmentType, GradingPeriod
from backend.models.score import StudentScore
from backend.models.audit import AuditLog
from backend.models.grade_consultation import GradeConsultation, AcademicStatus, AdvisingType
from backend.models.program import Program
from backend.models.curriculum import Curriculum
from backend.models.section import Section
from backend.models.enrollment import StudentEnrollment
import backend.models.grade_weight          # noqa: F401
import backend.models.grade_scale           # noqa: F401
import backend.models.tos                   # noqa: F401
import backend.models.attendance            # noqa: F401
import backend.models.instructor_intervention  # noqa: F401
import backend.models.sus_survey            # noqa: F401
import backend.models.academic_standing     # noqa: F401
from backend.models.curriculum_subject import CurriculumSubject


def now(offset_days=0):
    return datetime.now(timezone.utc) + timedelta(days=offset_days)


def _delete_course_sql(db, course_id: str) -> None:
    cid = course_id
    # competency_mastery FKs competencies, so clear it before competencies are deleted
    db.execute(text("DELETE FROM competency_mastery WHERE course_id = :c"), {"c": cid})
    aids = [r[0] for r in db.execute(text("SELECT id FROM assessments WHERE course_id = :c"), {"c": cid}).fetchall()]
    for aid in aids:
        db.execute(text("DELETE FROM student_scores WHERE assessment_id = :a"), {"a": str(aid)})
        db.execute(text("DELETE FROM table_of_specifications WHERE assessment_id = :a"), {"a": str(aid)})
        db.execute(text("DELETE FROM exam_questions WHERE assessment_id = :a"), {"a": str(aid)})
        db.execute(text("DELETE FROM assessment_items WHERE assessment_id = :a"), {"a": str(aid)})
    if aids:
        db.execute(text("DELETE FROM assessments WHERE course_id = :c"), {"c": cid})
    sids = [r[0] for r in db.execute(text("SELECT id FROM syllabi WHERE course_id = :c"), {"c": cid}).fetchall()]
    for sid in sids:
        db.execute(text("DELETE FROM competencies WHERE syllabus_id = :s"), {"s": str(sid)})
        db.execute(text("DELETE FROM syllabus_approvals WHERE syllabus_id = :s"), {"s": str(sid)})
    if sids:
        db.execute(text("DELETE FROM syllabi WHERE course_id = :c"), {"c": cid})
    for tbl in ("grade_weights", "risk_predictions", "grade_submissions",
                "instructor_interventions", "grade_consultations",
                "attendance_records", "academic_standings"):
        db.execute(text(f"DELETE FROM {tbl} WHERE course_id = :c"), {"c": cid})  # noqa: S608
    db.execute(text("DELETE FROM courses WHERE id = :c"), {"c": cid})


def get_or_create_user(db, email, defaults):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(**defaults)
        db.add(user)
        db.flush()
        print(f"  + Created: {email}")
    else:
        print(f"  ~ Exists:  {email}")
    return user


# ─── Data definitions ──────────────────────────────────────────────────────────

NEW_INSTRUCTORS = [
    dict(email="maria.santos@btech.edu", password="Demo@1234",
         full_name="Prof. Maria Santos", college="ICS"),
    dict(email="juan.delacruz@btech.edu", password="Demo@1234",
         full_name="Prof. Juan Dela Cruz", college="ICS"),
    dict(email="prof.ana.santos@btech.edu", password="Demo@1234",
         full_name="Prof. Ana Santos",  college="CBA"),
    dict(email="prof.robert.tan@btech.edu", password="Demo@1234",
         full_name="Prof. Robert Tan",  college="CoEd"),
]

NEW_PROGRAM_DIRECTORS = [
    dict(email="pd@ailas.edu",      password="PD@1234",
         full_name="Program Director", college="ICS"),
    dict(email="pd.ics@btech.edu", password="PD@1234",
         full_name="Dr. Luz Mendoza",  college="ICS"),
    dict(email="pd.cba@btech.edu",  password="PD@1234",
         full_name="Dr. Ramon Cruz",   college="CBA"),
]

NEW_DEANS = [
    dict(email="dean@ailas.edu",     password="Dean@1234",
         full_name="College Dean",     college="ICS"),
    dict(email="dean.ics@btech.edu", password="Dean@1234",
         full_name="Dr. Elena Santos", college="ICS"),
    dict(email="dean.cba@btech.edu",  password="Dean@1234",
         full_name="Dr. Victor Reyes", college="CBA"),
]

# VP for Academic Affairs is institution-wide, so no college is assigned
NEW_VPS = [
    dict(email="vp@ailas.edu", password="VP@1234",
         full_name="VP for Academic Affairs"),
]

# (email, password, full_name, student_number, year_level, program, section, college)
NEW_STUDENTS = [
    # Andrea retained — profile updated to CBA / 3rd Year / BSA
    ("andrea.reyes@students.btech.edu",     "Student@1234", "Andrea Reyes",        "2022-0001", "3rd Year", "BSA",    "BSA 3A",     "CBA"),
    # CBA (Accountancy) students
    ("mark.tolentino@students.btech.edu",   "Student@1234", "Mark Tolentino",      "2022-0002", "3rd Year", "BSA",    "BSA 3A",     "CBA"),
    ("grace.villanueva@students.btech.edu", "Student@1234", "Grace Villanueva",    "2022-0003", "3rd Year", "BSA",    "BSA 3B",     "CBA"),
    ("dante.cruz@students.btech.edu",       "Student@1234", "Dante Cruz",          "2022-0004", "3rd Year", "BSA",    "BSA 3B",     "CBA"),
    # ICS students
    ("jose.santos@students.btech.edu",      "Student@1234", "Jose Santos",         "2024-0001", "2nd Year", "BSIT",   "BSIT 2A",    "ICS"),
    ("liza.navarro@students.btech.edu",     "Student@1234", "Liza Navarro",        "2024-0002", "2nd Year", "BSIT",   "BSIT 2A",    "ICS"),
    ("felix.ramos@students.btech.edu",      "Student@1234", "Felix Ramos",         "2024-0003", "2nd Year", "BSCS",   "BSCS 2A",    "ICS"),
    # CoEd (Education) students
    ("ryan.mercado@students.btech.edu",     "Student@1234", "Ryan Mercado",        "2025-0001", "1st Year", "BEEd",   "BEEd 1A",    "CoEd"),
    ("pia.garcia@students.btech.edu",       "Student@1234", "Pia Garcia",          "2025-0002", "1st Year", "BEEd",   "BEEd 1A",    "CoEd"),
    # BSBA student (no course enrollment — tests the "no data" state)
    ("nina.reyes@students.btech.edu",       "Student@1234", "Nina Reyes",          "2024-0004", "2nd Year", "BSBA",   "BSBA 2A",    "CBA"),
]

PROGRAMS = [
    dict(program_name="Bachelor of Science in Accountancy",
         degree_type="Bachelor",
         ched_cmo_reference="CMO No. 27 s. 2017",
         total_units=174,
         description="Produces graduates competent in financial accounting, auditing, taxation, and management advisory services."),
    dict(program_name="Bachelor of Science in Information Technology",
         degree_type="Bachelor",
         ched_cmo_reference="CMO No. 25 s. 2015",
         total_units=170,
         description="Equips students with software development, networking, and database management competencies."),
    dict(program_name="Bachelor of Elementary Education",
         degree_type="Bachelor",
         ched_cmo_reference="CMO No. 74 s. 2017",
         total_units=152,
         description="Prepares licensed elementary teachers grounded in pedagogy, curriculum, and learner-centered instruction."),
]

CURRICULA = [
    dict(program_name="Bachelor of Science in Accountancy",
         name="BSA Curriculum 2022",   ched_cmo_reference="CMO No. 27 s. 2017",
         effective_year=2022, total_units=174),
    dict(program_name="Bachelor of Science in Information Technology",
         name="BSIT Curriculum 2022",  ched_cmo_reference="CMO No. 25 s. 2015",
         effective_year=2022, total_units=170),
    dict(program_name="Bachelor of Elementary Education",
         name="BEEd Curriculum 2022",  ched_cmo_reference="CMO No. 74 s. 2017",
         effective_year=2022, total_units=152),
]

# curriculum_name → [(subject_code, title, units, year_level, semester)]
# Subjects whose code matches a COURSES entry get linked to that course.
CURRICULUM_SUBJECTS = {
    "BSA Curriculum 2022": [
        ("ACCT 101", "Fundamentals of Accounting",            3, 1, 1),
        ("ACCT 102", "Partnership and Corporation Accounting", 3, 1, 2),
        ("ACCT 201", "Financial Accounting and Reporting",    3, 2, 1),
        ("ACCT 202", "Intermediate Accounting 1",             3, 2, 2),
        ("ACCT 301", "Cost Accounting and Cost Management",   3, 3, 1),
        ("ACCT 302", "Auditing and Assurance Principles",     3, 3, 2),
    ],
    "BSIT Curriculum 2022": [
        ("ITC 111", "Introduction to Computing",       3, 1, 1),
        ("ITC 112", "Computer Programming 1",          3, 1, 1),
        ("ITC 121", "Computer Programming 2",          3, 1, 2),
        ("ITC 211", "Database Management Systems",     3, 2, 1),
        ("ITC 212", "Data Structures and Algorithms",  3, 2, 1),
        ("ITC 221", "Web Systems and Technologies",    3, 2, 2),
        ("ITC 311", "Information Assurance and Security", 3, 3, 1),
    ],
    "BEEd Curriculum 2022": [
        ("EDUC 101", "The Child and Adolescent Learners and Learning Principles", 3, 1, 1),
        ("EDUC 102", "Facilitating Learner-Centered Teaching", 3, 1, 2),
        ("EDUC 201", "The Teaching Profession",               3, 2, 1),
        ("EDUC 202", "Assessment in Learning 1",              3, 2, 2),
        ("EDUC 301", "Technology for Teaching and Learning",  3, 3, 1),
    ],
}

SECTIONS = [
    dict(curriculum_name="BSA Curriculum 2022",   section_name="BSA 3A",   year_level=3, academic_year="2025-2026"),
    dict(curriculum_name="BSA Curriculum 2022",   section_name="BSA 3B",   year_level=3, academic_year="2025-2026"),
    dict(curriculum_name="BSIT Curriculum 2022",  section_name="BSIT 2A",  year_level=2, academic_year="2025-2026"),
    dict(curriculum_name="BSIT Curriculum 2022",  section_name="BSCS 2A",  year_level=2, academic_year="2025-2026"),
    dict(curriculum_name="BEEd Curriculum 2022",  section_name="BEEd 1A",  year_level=1, academic_year="2025-2026"),
]

# section_name → [student_numbers]
SECTION_ENROLLMENTS = {
    "BSA 3A":  ["2022-0001", "2022-0002"],
    "BSA 3B":  ["2022-0003", "2022-0004"],
    "BSIT 2A": ["2024-0001", "2024-0002"],
    "BSCS 2A": ["2024-0003"],
    "BEEd 1A": ["2025-0001", "2025-0002"],
}

# course key → (code, title, academic_period, instructor_email)
COURSES = {
    "acct201": ("ACCT 201", "Financial Accounting and Reporting",  "AY 2025-2026 1st Sem", "prof.ana.santos@btech.edu"),
    "acct301": ("ACCT 301", "Cost Accounting and Cost Management", "AY 2025-2026 1st Sem", "prof.ana.santos@btech.edu"),
    "itc211":  ("ITC 211",  "Database Management Systems",         "AY 2025-2026 1st Sem", "maria.santos@btech.edu"),
    "educ201": ("EDUC 201", "The Teaching Profession",             "AY 2025-2026 1st Sem", "prof.robert.tan@btech.edu"),
}

COMPETENCIES = {
    "acct201": [
        ("ACCT-01", "The Accounting Equation and Double-Entry System",
         ["Apply the accounting equation to business transactions", "Analyze the effect of transactions on assets, liabilities, and equity"]),
        ("ACCT-02", "Journalizing and Posting Transactions",
         ["Record business transactions in the general journal", "Post journal entries to the general ledger"]),
        ("ACCT-03", "Adjusting Entries and the Accrual Basis",
         ["Prepare adjusting entries for accruals and deferrals", "Differentiate the accrual basis from the cash basis of accounting"]),
        ("ACCT-04", "Preparation of Financial Statements",
         ["Prepare an income statement and a classified balance sheet", "Construct a statement of changes in equity"]),
        ("ACCT-05", "Cash Control and Bank Reconciliation",
         ["Prepare a bank reconciliation statement", "Apply internal control procedures over cash"]),
    ],
    "acct301": [
        ("COST-01", "Cost Concepts and Classification",
         ["Classify costs as direct, indirect, fixed, and variable", "Distinguish product costs from period costs"]),
        ("COST-02", "Job Order Costing",
         ["Compute job costs using a predetermined overhead rate", "Prepare job cost sheets"]),
        ("COST-03", "Process Costing",
         ["Compute equivalent units of production", "Apply the weighted-average process costing method"]),
        ("COST-04", "Cost-Volume-Profit Analysis",
         ["Compute the break-even point in units and in pesos", "Apply CVP analysis to profit planning"]),
        ("COST-05", "Budgeting and Variance Analysis",
         ["Prepare an operating budget", "Compute and interpret cost variances"]),
    ],
    "itc211": [
        ("DBMS-01", "Relational Database Concepts",
         ["Define RDBMS components and terminology", "Design entity-relationship diagrams"]),
        ("DBMS-02", "SQL and Query Optimization",
         ["Write SELECT, JOIN, and aggregate SQL queries", "Identify and apply query optimization techniques"]),
        ("DBMS-03", "Database Normalization",
         ["Apply 1NF, 2NF, and 3NF normalization rules", "Identify and resolve data anomalies"]),
        ("DBMS-04", "Transaction Management and Concurrency",
         ["Explain ACID properties of transactions", "Describe concurrency control mechanisms"]),
        ("DBMS-05", "Database Security and Administration",
         ["Implement user roles and access controls", "Perform database backup and recovery procedures"]),
    ],
    "educ201": [
        ("EDUC-01", "Foundations and History of Philippine Education",
         ["Trace the development of the Philippine educational system", "Explain the legal bases of Philippine education"]),
        ("EDUC-02", "Philippine Professional Standards for Teachers (PPST)",
         ["Describe the seven domains of the PPST", "Relate the PPST to the teacher's career stages"]),
        ("EDUC-03", "Learner-Centered Teaching Principles",
         ["Apply learner-centered psychological principles", "Differentiate teaching strategies for diverse learners"]),
        ("EDUC-04", "Curriculum and Instructional Planning",
         ["Formulate learning outcomes using Bloom's taxonomy", "Prepare a daily lesson plan aligned to the K-12 curriculum"]),
        ("EDUC-05", "Assessment of Learning",
         ["Construct a table of specifications for a test", "Differentiate formative from summative assessment"]),
    ],
}

QUESTIONS = {
    "ACCT-01": "A business owner invests PHP 500,000 cash and a delivery vehicle worth PHP 300,000. Show the effect of this transaction on the accounting equation.",
    "ACCT-02": "Journalize the purchase of office supplies on account for PHP 12,000 and the subsequent partial payment of PHP 5,000, then post to the cash and accounts payable ledgers.",
    "ACCT-03": "Prepare the adjusting entry for PHP 18,000 of prepaid insurance, one-third of which has expired at year-end.",
    "ACCT-04": "From the adjusted trial balance provided, prepare a single-step income statement and a classified balance sheet.",
    "ACCT-05": "Prepare a bank reconciliation given a book balance of PHP 84,500, a bank balance of PHP 90,200, deposits in transit of PHP 7,000, and outstanding checks of PHP 12,700.",
    "COST-01": "Classify each of the following as direct material, direct labor, or manufacturing overhead: factory rent, assembly-line wages, glue used in production, and machine depreciation.",
    "COST-02": "A job used PHP 40,000 of direct materials and PHP 25,000 of direct labor; overhead is applied at 150% of direct labor cost. Compute the total cost of the job.",
    "COST-03": "A department had 8,000 units that were 60% complete in beginning work-in-process and started 30,000 units. Compute the equivalent units of production using the weighted-average method.",
    "COST-04": "A product sells for PHP 250 with a variable cost of PHP 150 per unit and total fixed costs of PHP 400,000. Compute the break-even point in units and in pesos.",
    "COST-05": "Standard material cost is 3 kg at PHP 50/kg; actual usage was 3.2 kg at PHP 48/kg for 1,000 units. Compute the material price and quantity variances.",
    "DBMS-01": "Design an ER diagram for a university enrollment system with entities Student, Course, Instructor, and Section.",
    "DBMS-02": "Write a SQL query to retrieve the top 5 students by average grade using GROUP BY and ORDER BY.",
    "DBMS-03": "Normalize the relation Student(SID, Name, CourseID, CourseName, InstructorID, InstructorName) to 3NF.",
    "DBMS-04": "Explain the ACID properties and describe how a DBMS ensures atomicity during a bank transfer transaction.",
    "DBMS-05": "Implement role-based access control in PostgreSQL: create an analyst role with SELECT-only permissions.",
    "EDUC-01": "Explain how the Education Act of 1982 and RA 10533 (Enhanced Basic Education Act of 2013) shaped the current Philippine educational system.",
    "EDUC-02": "Identify the seven domains of the PPST and describe one indicator a beginning teacher must demonstrate.",
    "EDUC-03": "Design a differentiated activity for a mixed-ability Grade 4 class studying fractions.",
    "EDUC-04": "Formulate three learning outcomes for a lesson on photosynthesis — one each at the Remember, Apply, and Analyze levels of Bloom's taxonomy.",
    "EDUC-05": "Construct a table of specifications for a 40-item test covering four topics with varying time allotments.",
}

# student_number → {comp_code: [prelim, midterm, semi_final, final]}
SCORES = {
    "acct201": {
        "2022-0001": {  # Andrea — Excelling
            "ACCT-01": [9, 9, 10, 10], "ACCT-02": [9, 9,  9, 10],
            "ACCT-03": [8, 9,  9, 10], "ACCT-04": [9, 9, 10, 10], "ACCT-05": [8, 9, 9, 10],
        },
        "2022-0002": {  # Mark — On-Track
            "ACCT-01": [7, 8, 8, 8], "ACCT-02": [7, 7, 8, 8],
            "ACCT-03": [7, 7, 8, 8], "ACCT-04": [7, 8, 8, 8], "ACCT-05": [7, 7, 8, 8],
        },
        "2022-0003": {  # Grace — On-Track
            "ACCT-01": [8, 8, 8, 8], "ACCT-02": [7, 7, 8, 8],
            "ACCT-03": [7, 8, 8, 8], "ACCT-04": [7, 7, 7, 8], "ACCT-05": [8, 8, 8, 8],
        },
        "2022-0004": {  # Dante — At-Risk (declining)
            "ACCT-01": [7, 7, 6, 6], "ACCT-02": [7, 6, 6, 5],
            "ACCT-03": [7, 6, 5, 5], "ACCT-04": [6, 6, 6, 5], "ACCT-05": [7, 6, 6, 5],
        },
    },
    "acct301": {
        "2022-0001": {  # Andrea — Excelling
            "COST-01": [9, 9, 10, 10], "COST-02": [8, 9,  9, 10],
            "COST-03": [9, 9,  9, 10], "COST-04": [8, 9,  9,  9], "COST-05": [9, 9, 10, 10],
        },
        "2022-0002": {  # Mark — On-Track
            "COST-01": [7, 7, 8, 8], "COST-02": [7, 8, 8, 8],
            "COST-03": [7, 7, 7, 8], "COST-04": [7, 7, 8, 8], "COST-05": [8, 8, 8, 8],
        },
        "2022-0003": {  # Grace — On-Track
            "COST-01": [8, 8, 8, 8], "COST-02": [7, 7, 7, 8],
            "COST-03": [7, 8, 8, 8], "COST-04": [7, 7, 8, 8], "COST-05": [7, 8, 8, 8],
        },
    },
    "itc211": {
        "2024-0001": {  # Jose — On-Track
            "DBMS-01": [7, 8, 8, 8], "DBMS-02": [7, 7, 8, 8],
            "DBMS-03": [7, 7, 8, 8], "DBMS-04": [7, 8, 8, 8], "DBMS-05": [7, 7, 7, 8],
        },
        "2024-0002": {  # Liza — Excelling
            "DBMS-01": [9, 9, 10, 10], "DBMS-02": [8, 9,  9, 10],
            "DBMS-03": [9, 9,  9, 10], "DBMS-04": [8, 9,  9, 10], "DBMS-05": [9, 9, 9, 10],
        },
        "2024-0003": {  # Felix — At-Risk (low)
            "DBMS-01": [6, 6, 6, 7], "DBMS-02": [5, 6, 6, 6],
            "DBMS-03": [5, 5, 6, 6], "DBMS-04": [6, 6, 6, 7], "DBMS-05": [5, 5, 6, 6],
        },
    },
    "educ201": {
        "2025-0001": {  # Ryan — On-Track
            "EDUC-01": [7, 8, 8, 8], "EDUC-02": [7, 7, 8, 8],
            "EDUC-03": [7, 7, 7, 8], "EDUC-04": [7, 8, 8, 8], "EDUC-05": [7, 7, 8, 8],
        },
        "2025-0002": {  # Pia — Excelling
            "EDUC-01": [9, 9, 10, 10], "EDUC-02": [8, 9,  9, 10],
            "EDUC-03": [9, 9,  9, 10], "EDUC-04": [8, 8,  9,  9], "EDUC-05": [9, 9, 9, 10],
        },
    },
}

PERIODS       = [GradingPeriod.prelim, GradingPeriod.midterm, GradingPeriod.semi_final, GradingPeriod.final]
PERIOD_LABELS = ["Prelim", "Midterm", "Semi-Final", "Final"]


# ─── Main ──────────────────────────────────────────────────────────────────────

def seed_demo():
    db = SessionLocal()
    try:
        print("\n=== AILAS Demo Seed v2 — BTECH Edition ===\n")

        # ── 0. CLEANUP ─────────────────────────────────────────────────────────
        print("[0] Cleanup")

        # Delete in FK-safe order: leaf tables first
        db.execute(text("DELETE FROM sus_survey_responses"))
        db.execute(text("DELETE FROM student_enrollments"))
        db.execute(text("DELETE FROM sections"))
        db.execute(text("DELETE FROM audit_logs"))
        db.commit()
        print("  OK Cleared enrollments / sections / audit logs")

        # Courses reference curriculum_subjects, so delete courses first
        old_course_ids = [r[0] for r in db.execute(text("SELECT id FROM courses")).fetchall()]
        for cid in old_course_ids:
            _delete_course_sql(db, str(cid))
        db.commit()
        print(f"  OK Deleted {len(old_course_ids)} old course(s) and all dependents")

        # Now safe to clear curriculum structure
        db.execute(text("DELETE FROM curriculum_subjects"))
        db.execute(text("DELETE FROM curricula"))
        db.execute(text("DELETE FROM programs"))
        db.commit()
        print("  OK Cleared programs / curricula / curriculum_subjects")

        db.execute(text(
            "DELETE FROM users WHERE role = 'student' AND email != 'andrea.reyes@students.btech.edu'"
        ))
        db.commit()
        print("  OK Removed old students (kept andrea.reyes)")

        # ── 1. NEW INSTRUCTORS ─────────────────────────────────────────────────
        print("\n[1] Instructors")
        inst_map = {}
        for inst in NEW_INSTRUCTORS:
            user = get_or_create_user(db, inst["email"], {
                "email":         inst["email"],
                "password_hash": hash_password(inst["password"]),
                "full_name":     inst["full_name"],
                "role":          UserRole.instructor,
                "college":       inst["college"],
                "is_active":     True,
            })
            inst_map[inst["email"]] = user

        for email, college in [("maria.santos@btech.edu", "ICS"), ("juan.delacruz@btech.edu", "ICS")]:
            u = db.query(User).filter(User.email == email).first()
            if u:
                u.college = college
                inst_map[email] = u
                print(f"  ~ Updated college → ICS: {email}")
        db.commit()

        # ── 2. NEW PROGRAM DIRECTORS ───────────────────────────────────────────
        print("\n[2] Program Directors")
        for pd_user in NEW_PROGRAM_DIRECTORS:
            get_or_create_user(db, pd_user["email"], {
                "email":         pd_user["email"],
                "password_hash": hash_password(pd_user["password"]),
                "full_name":     pd_user["full_name"],
                "role":          UserRole.program_director,
                "college":       pd_user["college"],
                "is_active":     True,
            })
        db.commit()

        # ── 3. NEW DEANS ───────────────────────────────────────────────────────
        print("\n[3] Deans")
        for dean_user in NEW_DEANS:
            get_or_create_user(db, dean_user["email"], {
                "email":         dean_user["email"],
                "password_hash": hash_password(dean_user["password"]),
                "full_name":     dean_user["full_name"],
                "role":          UserRole.dean,
                "college":       dean_user["college"],
                "is_active":     True,
            })
        db.commit()

        # ── 3b. VP FOR ACADEMIC AFFAIRS ────────────────────────────────────────
        print("\n[3b] VP for Academic Affairs")
        for vp_user in NEW_VPS:
            get_or_create_user(db, vp_user["email"], {
                "email":         vp_user["email"],
                "password_hash": hash_password(vp_user["password"]),
                "full_name":     vp_user["full_name"],
                "role":          UserRole.vp_academic_affairs,
                "college":       None,
                "is_active":     True,
            })
        db.commit()

        # ── 4. STUDENTS ────────────────────────────────────────────────────────
        print("\n[4] Students")
        student_map = {}  # student_number → User
        for email, password, full_name, student_number, year_level, program, section, college in NEW_STUDENTS:
            existing = db.query(User).filter(User.email == email).first()
            if existing:
                existing.year_level     = year_level
                existing.program        = program
                existing.section        = section
                existing.college        = college
                existing.student_number = student_number
                db.flush()
                student_map[student_number] = existing
                print(f"  ~ Updated: {email}  [{college}, {year_level}, {program}]")
            else:
                user = User(
                    email=email,
                    password_hash=hash_password(password),
                    full_name=full_name,
                    role=UserRole.student,
                    student_number=student_number,
                    year_level=year_level,
                    program=program,
                    section=section,
                    college=college,
                    is_active=True,
                )
                db.add(user)
                db.flush()
                student_map[student_number] = user
                print(f"  + Created: {email}  [{college}, {year_level}, {program}]")
        db.commit()

        # ── 5. PROGRAMS ────────────────────────────────────────────────────────
        print("\n[5] Programs")
        program_map = {}
        for prog in PROGRAMS:
            p = Program(**prog)
            db.add(p)
            db.flush()
            program_map[prog["program_name"]] = p
            print(f"  + {prog['degree_type']} in {prog['program_name'].split(' in ')[-1]}")
        db.commit()

        # ── 6. CURRICULA ───────────────────────────────────────────────────────
        print("\n[6] Curricula")
        curriculum_map = {}
        for curr in CURRICULA:
            c = Curriculum(
                program_id=program_map[curr["program_name"]].id,
                name=curr["name"],
                ched_cmo_reference=curr["ched_cmo_reference"],
                effective_year=curr["effective_year"],
                total_units=curr["total_units"],
                status="active",
            )
            db.add(c)
            db.flush()
            curriculum_map[curr["name"]] = c
            print(f"  + {curr['name']}  ({curr['total_units']} units, eff. {curr['effective_year']})")
        db.commit()

        # ── 6b. CURRICULUM SUBJECTS ────────────────────────────────────────────
        print("\n[6b] Curriculum Subjects")
        subject_by_code = {}
        for curr_name, subjects in CURRICULUM_SUBJECTS.items():
            for code, title, units, year_level, semester in subjects:
                subj = CurriculumSubject(
                    curriculum_id=curriculum_map[curr_name].id,
                    subject_code=code,
                    title=title,
                    units=units,
                    year_level=year_level,
                    semester=semester,
                )
                db.add(subj)
                db.flush()
                subject_by_code[code] = subj
            print(f"  + {len(subjects)} subjects → {curr_name}")
        db.commit()

        # ── 7. SECTIONS ────────────────────────────────────────────────────────
        print("\n[7] Sections")
        section_map = {}
        for sec in SECTIONS:
            s = Section(
                curriculum_id=curriculum_map[sec["curriculum_name"]].id,
                section_name=sec["section_name"],
                year_level=sec["year_level"],
                academic_year=sec["academic_year"],
            )
            db.add(s)
            db.flush()
            section_map[sec["section_name"]] = s
            print(f"  + {sec['section_name']}  (Year {sec['year_level']}, {sec['academic_year']})")
        db.commit()

        # ── 8. SECTION ENROLLMENTS ─────────────────────────────────────────────
        print("\n[8] Section Enrollments")
        total_links = 0
        for sec_name, student_numbers in SECTION_ENROLLMENTS.items():
            sec = section_map[sec_name]
            for snum in student_numbers:
                student = student_map.get(snum)
                if not student:
                    continue
                db.add(StudentEnrollment(
                    student_id_hash=hash_student_id(snum),
                    section_id=sec.id,
                    curriculum_id=sec.curriculum_id,
                    status="active",
                ))
                total_links += 1
        db.commit()
        print(f"  OK {total_links} student-section links created")

        # ── 9. COURSES ─────────────────────────────────────────────────────────
        print("\n[9] Courses")
        # Re-fetch instructors after commit to avoid detached instance errors
        for email in list(inst_map.keys()):
            u = db.query(User).filter(User.email == email).first()
            if u:
                inst_map[email] = u

        course_map = {}
        for key, (code, title, period, inst_email) in COURSES.items():
            inst = inst_map.get(inst_email) or db.query(User).filter(User.email == inst_email).first()
            if not inst:
                print(f"  ERR Instructor not found: {inst_email} — skipping {code}")
                continue
            subj = subject_by_code.get(code)
            course = Course(title=title, code=code, academic_period=period, instructor_id=inst.id,
                            curriculum_subject_id=subj.id if subj else None)
            db.add(course)
            db.flush()
            course_map[key] = course
            print(f"  + {code} — {title}  ({inst.full_name})")
        db.commit()

        # ── 10. SYLLABI & COMPETENCIES ─────────────────────────────────────────
        print("\n[10] Syllabi & Competencies")
        competency_map = {}  # (course_key, comp_code) → Competency
        for course_key, comp_list in COMPETENCIES.items():
            course = course_map.get(course_key)
            if not course:
                continue
            syllabus = Syllabus(
                course_id=course.id,
                file_path=f"uploads/syllabi/demo_{course_key}.pdf",
                raw_text=f"Demo syllabus for {course.title}",
                parsed_json={"competencies": [
                    {"competency_code": c, "topic_name": t, "learning_outcomes": lo}
                    for c, t, lo in comp_list
                ]},
                status=SyllabusStatus.validated,
                approval_stage=ApprovalStage.fully_approved,
                validated_at=now(-30),
            )
            db.add(syllabus)
            db.flush()
            for comp_code, topic_name, learning_outcomes in comp_list:
                comp = Competency(
                    syllabus_id=syllabus.id,
                    competency_code=comp_code,
                    topic_name=topic_name,
                    learning_outcomes=learning_outcomes,
                )
                db.add(comp)
                db.flush()
                competency_map[(course_key, comp_code)] = comp
            print(f"  + {course.code}: {len(comp_list)} competencies")
        db.commit()

        # ── 11. ASSESSMENTS & SCORES ───────────────────────────────────────────
        print("\n[11] Assessments & Scores")
        for course_key, course in course_map.items():
            comp_codes      = [c[0] for c in COMPETENCIES[course_key]]
            course_scores   = SCORES.get(course_key, {})
            enrolled_snums  = list(course_scores.keys())

            for period_idx, period in enumerate(PERIODS):
                assessment = Assessment(
                    course_id=course.id,
                    title=f"{PERIOD_LABELS[period_idx]} Assessment",
                    type=AssessmentType.exam,
                    grading_period=period,
                    date=now(-(90 - period_idx * 21)),
                )
                db.add(assessment)
                db.flush()

                for comp_code in comp_codes:
                    comp = competency_map.get((course_key, comp_code))
                    if not comp:
                        continue
                    db.add(AssessmentItem(
                        assessment_id=assessment.id,
                        question_text=QUESTIONS.get(comp_code, f"Question for {comp_code}"),
                        mapped_competency_id=comp.id,
                        confidence_score=0.93,
                        needs_review=False,
                    ))

                for snum in enrolled_snums:
                    sid_hash = hash_student_id(snum)
                    student_scores = course_scores.get(snum, {})
                    for comp_code in comp_codes:
                        comp = competency_map.get((course_key, comp_code))
                        if not comp:
                            continue
                        vals = student_scores.get(comp_code, [7, 7, 7, 7])
                        db.add(StudentScore(
                            student_id_hash=sid_hash,
                            assessment_id=assessment.id,
                            competency_id=comp.id,
                            grading_period=period,
                            score=float(vals[period_idx]),
                            max_score=10.0,
                            submission_date=now(-(91 - period_idx * 21)),
                        ))

            db.commit()
            print(f"  + {course.code}: {len(PERIODS)} periods × {len(enrolled_snums)} students × {len(comp_codes)} competencies")

        # ── 11b. COMPETENCY MASTERY (pre-aggregation, Table 9) ──────────────────
        print("\n[11b] Competency Mastery")
        from backend.services.ai.feature_engineering import recompute_competency_mastery
        total_mastery = 0
        for course_key, course in course_map.items():
            total_mastery += recompute_competency_mastery(str(course.id), db)
        print(f"  + {total_mastery} competency-mastery rows written")

        # ── 12. AUDIT LOGS ─────────────────────────────────────────────────────
        print("\n[12] Audit Logs")
        admin  = db.query(User).filter(User.role == UserRole.admin).first()
        ana    = db.query(User).filter(User.email == "prof.ana.santos@btech.edu").first()
        maria  = db.query(User).filter(User.email == "maria.santos@btech.edu").first()
        robert = db.query(User).filter(User.email == "prof.robert.tan@btech.edu").first()

        log_entries = [
            (admin,  "login",                  None,          None, None,                                       0),
            (admin,  "create_user",             "users",       None, {"email": "prof.ana.santos@btech.edu"},   -40),
            (admin,  "create_user",             "users",       None, {"email": "prof.robert.tan@btech.edu"},   -40),
            (admin,  "bulk_import_students",    "users",       None, {"count": 10},                            -38),
            (ana,    "login",                   None,          None, None,                                      -2),
            (ana,    "upload_syllabus",         "syllabi",     None, {"course": "ACCT 201"},                   -29),
            (ana,    "validate_syllabus",       "syllabi",     None, {"course": "ACCT 201"},                   -28),
            (ana,    "upload_csv",              "assessments", None, {"file": "ACCT201_Prelim_Scores.csv"},    -25),
            (ana,    "upload_syllabus",         "syllabi",     None, {"course": "ACCT 301"},                   -27),
            (ana,    "validate_syllabus",       "syllabi",     None, {"course": "ACCT 301"},                   -26),
            (ana,    "upload_csv",              "assessments", None, {"file": "ACCT301_Prelim_Scores.csv"},    -24),
            (maria,  "login",                   None,          None, None,                                      -3),
            (maria,  "upload_syllabus",         "syllabi",     None, {"course": "ITC 211"},                    -27),
            (maria,  "validate_syllabus",       "syllabi",     None, {"course": "ITC 211"},                    -26),
            (maria,  "upload_csv",              "assessments", None, {"file": "ITC211_Prelim_Scores.csv"},     -23),
            (robert, "login",                   None,          None, None,                                      -1),
            (robert, "upload_syllabus",         "syllabi",     None, {"course": "EDUC 201"},                   -26),
            (robert, "validate_syllabus",       "syllabi",     None, {"course": "EDUC 201"},                   -25),
            (robert, "upload_csv",              "assessments", None, {"file": "EDUC201_Prelim_Scores.csv"},    -22),
        ]

        count = 0
        for user_obj, action, tbl, tgt, extra, day in log_entries:
            if not user_obj:
                continue
            db.add(AuditLog(
                id=str(uuid.uuid4()),
                user_id=str(user_obj.id),
                action=action,
                target_table=tbl,
                target_id=tgt,
                extra_data=extra,
                timestamp=now(day),
            ))
            count += 1
        db.commit()
        print(f"  + {count} audit log entries")

        # ── 13. GRADE CONSULTATIONS ────────────────────────────────────────────
        print("\n[13] Grade Consultations")
        dante_course = course_map.get("acct201")
        felix_course = course_map.get("itc211")

        if dante_course and ana:
            db.add(GradeConsultation(
                instructor_id=ana.id,
                course_id=dante_course.id,
                student_id_hash=hash_student_id("2022-0004"),
                grading_period=GradingPeriod.midterm,
                conducted_at=now(-15),
                academic_status=AcademicStatus.failed,
                notes="Student's performance is declining across all ACCT 201 competencies. Attendance is irregular.",
                next_steps="Conduct bi-weekly remediation sessions. Coordinate with academic advisor.",
                advising_type=AdvisingType.remediation,
                advising_content="Reviewed the accounting equation and adjusting-entry fundamentals. Assigned supplementary modules.",
                retake_recommended=True,
                retake_notes="Recommend retaking if the Final score does not reach the passing threshold.",
            ))

        if felix_course and maria:
            db.add(GradeConsultation(
                instructor_id=maria.id,
                course_id=felix_course.id,
                student_id_hash=hash_student_id("2024-0003"),
                grading_period=GradingPeriod.prelim,
                conducted_at=now(-20),
                academic_status=AcademicStatus.failed,
                notes="Student consistently scores below passing in SQL and normalization. Submitted only 2 of 4 activities.",
                next_steps="Assigned W3Schools SQL track and SQLZoo exercises. Follow-up consultation in 2 weeks.",
                advising_type=AdvisingType.counseling_referral,
                advising_content="Discussed workload distribution and availability of free tutoring at the ICS lab.",
                retake_recommended=False,
            ))
        db.commit()
        print("  + 2 grade consultations created")

        # ── SUMMARY ────────────────────────────────────────────────────────────
        print("\n" + "=" * 56)
        print("  Seed Complete — BTECH Edition")
        print("=" * 56)
        print("\nExisting accounts (unchanged passwords):")
        print("  Admin   : admin@ailas.edu              / Admin@1234")
        print("  PD      : pd@ailas.edu                 / PD@1234    [ICS]")
        print("  Dean    : dean@ailas.edu               / Dean@1234  [ICS]")
        print("  VP      : vp@ailas.edu                 / VP@1234    [all colleges]")
        print("  Instr.  : maria.santos@btech.edu       / Demo@1234  → ITC 211 [ICS]")
        print("  Instr.  : juan.delacruz@btech.edu      / Demo@1234  [ICS]")
        print("\nNew accounts:")
        print("  Instr.  : prof.ana.santos@btech.edu    / Demo@1234  → ACCT 201, ACCT 301 [CBA]")
        print("  Instr.  : prof.robert.tan@btech.edu    / Demo@1234  → EDUC 201 [CoEd]")
        print("  PD      : pd.ics@btech.edu             / PD@1234    [ICS]")
        print("  PD      : pd.cba@btech.edu             / PD@1234    [CBA]")
        print("  Dean    : dean.ics@btech.edu           / Dean@1234  [ICS]")
        print("  Dean    : dean.cba@btech.edu           / Dean@1234  [CBA]")
        print("\nStudents (all / Student@1234):")
        print("  andrea.reyes@students.btech.edu        [CBA, 3rd BSA]  — Excelling (ACCT 201, ACCT 301)")
        print("  mark.tolentino@students.btech.edu      [CBA, 3rd BSA]  — On-Track")
        print("  grace.villanueva@students.btech.edu    [CBA, 3rd BSA]  — On-Track")
        print("  dante.cruz@students.btech.edu          [CBA, 3rd BSA]  — At-Risk (declining)")
        print("  liza.navarro@students.btech.edu        [ICS, 2nd BSIT] — Excelling (ITC 211)")
        print("  jose.santos@students.btech.edu         [ICS, 2nd BSIT] — On-Track")
        print("  felix.ramos@students.btech.edu         [ICS, 2nd BSCS] — At-Risk")
        print("  pia.garcia@students.btech.edu          [CoEd, 1st BEEd] — Excelling (EDUC 201)")
        print("  ryan.mercado@students.btech.edu        [CoEd, 1st BEEd] — On-Track")
        print("  nina.reyes@students.btech.edu          [CBA,  2nd BSBA] — no courses yet")

    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] {e}")
        import traceback; traceback.print_exc()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo()
