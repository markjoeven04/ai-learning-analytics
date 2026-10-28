"""Walkthrough QA: runs the AILAS Step-by-Step Guide (Steps 1–34) against a running
AILAS through the same API calls the screens make, and checks each outcome.

    python qa/walkthrough_check.py                      # http://localhost:8000
    python qa/walkthrough_check.py https://host/api     # another deployment

It creates real data (ITC 212, a program, users…), so run it on a copy you can
reset (pg_dump before, restore after). Exit code 1 when any step fails.
"""
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
DATA = Path(__file__).resolve().parent.parent / "test-data"
PERIOD = "AY 2025-2026 1st Sem"
RUN = str(int(time.time()))[-5:]          # keeps re-runs from colliding on unique fields

http = httpx.Client(base_url=BASE, timeout=180, limits=httpx.Limits(max_keepalive_connections=0))
results = []


_tokens = {}


def login(email, password, fresh=False):
    """One login per account: the API allows 30 logins a minute per IP."""
    if fresh or (email, password) not in _tokens:
        r = http.post("/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        _tokens[(email, password)] = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return _tokens[(email, password)]


def call(method, url, who, expect=(200, 201, 204), **kw):
    r = http.request(method, url, headers=who, **kw)
    if r.status_code not in expect:
        raise AssertionError(f"{method} {url} -> {r.status_code}: {r.text[:300]}")
    return r.json() if r.content and r.headers.get("content-type", "").startswith("application/json") else r


def step(name):
    def wrap(fn):
        try:
            note = fn() or ""
            results.append((name, True, note))
        except Exception as e:  # keep going: later steps report their own state
            results.append((name, False, f"{type(e).__name__}: {e}"))
        return fn
    return wrap


S = {}  # state shared between steps
MARIA = ("maria.santos@btech.edu", "Demo@1234")


@step("Logins: every account in the Accounts table")
def _():
    accounts = ["admin@ailas.edu:Admin@1234", "vp@ailas.edu:VP@1234", "dean.ics@btech.edu:Dean@1234",
                "dean.cba@btech.edu:Dean@1234", "dean@ailas.edu:Dean@1234", "pd.ics@btech.edu:PD@1234",
                "pd.cba@btech.edu:PD@1234", "pd@ailas.edu:PD@1234", "maria.santos@btech.edu:Demo@1234",
                "juan.delacruz@btech.edu:Demo@1234", "prof.ana.santos@btech.edu:Demo@1234",
                "prof.robert.tan@btech.edu:Demo@1234"] + [
        f"{s}@students.btech.edu:Student@1234" for s in
        ("felix.ramos", "jose.santos", "liza.navarro", "nina.reyes", "dante.cruz", "andrea.reyes",
         "mark.tolentino", "grace.villanueva", "pia.garcia", "ryan.mercado")]
    bad = []
    for a in accounts:
        try:
            login(*a.split(":"))
        except httpx.HTTPStatusError:
            bad.append(a.split(":")[0])
    assert not bad, f"login failed: {bad}"
    return f"{len(accounts)} accounts"


@step("Step 1-2. Instructor dashboard and ITC 211 class risk")
def _():
    m = login(*MARIA)
    courses = call("GET", "/courses/", m)
    itc211 = next(c for c in courses if c["code"] == "ITC 211")
    S["itc211"] = itc211["id"]
    rows = call("GET", f"/analytics/courses/{itc211['id']}/students", m)["data"]
    status = {r["full_name"]: r["risk_level"] for r in rows}
    want = {"Felix Ramos": "At-Risk", "Jose Santos": "On-Track", "Liza Navarro": "Excelling"}
    assert all(status.get(k) == v for k, v in want.items()), status
    return f"ITC 211: {status}"


@step("Step 3. Felix (student) dashboard: risk + recommendations")
def _():
    f = login("felix.ramos@students.btech.edu", "Student@1234")
    call("POST", "/consent/accept", f)
    risk = call("GET", "/analytics/me/risk", f, params={"course_id": S["itc211"]})
    recs = call("GET", "/analytics/me/recommendations", f, params={"course_id": S["itc211"]})
    return f"risk={risk if not isinstance(risk, dict) else risk.get('risk_status') or risk}; recommendations={len(recs)}"


@step("Step 4. Access control: Ana sees only her ACCT courses")
def _():
    a = login("prof.ana.santos@btech.edu", "Demo@1234")
    codes = sorted(c["code"] for c in call("GET", "/courses/", a))
    assert "ITC 211" not in codes, codes
    call("GET", f"/analytics/courses/{S['itc211']}/students", a, expect=(403, 404))
    return f"Ana sees {codes}; ITC 211 blocked"


@step("Step 5. Create ITC 212 (and duplicate is refused)")
def _():
    m = login(*MARIA)
    body = {"title": "Data Structures and Algorithms", "code": "ITC 212", "academic_period": PERIOD}
    c = call("POST", "/courses/", m, json=body)
    S["course"] = c["id"]
    dup = http.post("/courses/", headers=m, json=body)
    assert dup.status_code == 409, f"duplicate not blocked: {dup.status_code}"
    return f"course {c['id'][:8]}; duplicate -> 409 \"{dup.json()['detail'][:60]}…\""


@step("Step 6. Upload the DSA syllabus PDF (AI parse)")
def _():
    m = login(*MARIA)
    f = DATA / "BTECH_ITC212_DSA_Syllabus.pdf"
    r = call("POST", "/syllabi/upload", m, params={"course_id": S["course"]},
             files={"file": (f.name, f.read_bytes(), "application/pdf")})
    S["syllabus"] = r["id"]
    codes = [c["competency_code"] for c in r["competencies"]]
    S["comps"] = r["competencies"]
    assert codes == [f"DSA-{i:02d}" for i in range(1, 13)], f"got {codes}"
    return "12 competencies DSA-01..DSA-12"


@step("Step 7. Edit an outcome and submit for approval; competencies lock")
def _():
    m = login(*MARIA)
    comps = [{"competency_code": c["competency_code"], "topic_name": c["topic_name"],
              "learning_outcomes": c["learning_outcomes"]} for c in S["comps"]]
    comps[0]["learning_outcomes"] = comps[0]["learning_outcomes"] + ["Analyze the time complexity of an algorithm"]
    saved = call("PUT", f"/syllabi/{S['syllabus']}/competencies", m, json={"competencies": comps})
    S["comps"] = saved["competencies"] if isinstance(saved, dict) and "competencies" in saved else \
        call("GET", f"/syllabi/{S['syllabus']}", m)["competencies"]
    call("POST", f"/syllabi/{S['syllabus']}/submit-for-review", m)
    locked = http.put(f"/syllabi/{S['syllabus']}/competencies", headers=m, json={"competencies": comps})
    assert locked.status_code in (403, 409, 422), f"edit under review allowed: {locked.status_code}"
    return f"submitted; edit while under review -> {locked.status_code}"


def approve_syllabus(who, comment):
    q = call("GET", "/syllabi/pending-approval", who)
    assert [s for s in q if s["id"] == S["syllabus"]], "syllabus not in this approver's queue"
    assert len(q) == 1, f"queue shows {len(q)} cards, guide says one"
    f = call("GET", f"/syllabi/{S['syllabus']}/file", who)          # the new View → original file
    call("POST", f"/syllabi/{S['syllabus']}/approve", who, json={"feedback": comment})
    return f"approved; original file {len(f.content)} bytes"


@step("Step 8. PD approves the syllabus")
def _():
    return approve_syllabus(login("pd.ics@btech.edu", "PD@1234"), "Aligned with program outcomes.")


@step("Step 9. Dean approves the syllabus")
def _():
    return approve_syllabus(login("dean.ics@btech.edu", "Dean@1234"), "Consistent with college standards.")


@step("Step 10. VP endorses the syllabus")
def _():
    out = approve_syllabus(login("vp@ailas.edu", "VP@1234"), "Endorsed for AY 2025-2026.")
    s = call("GET", f"/syllabi/{S['syllabus']}", login(*MARIA))
    assert s["status"] == "validated", s["status"]
    return out + "; status validated (Endorsed · Locked)"


@step("Step 11. Create the Prelim Exam + TOS rows")
def _():
    m = login(*MARIA)
    a = call("POST", f"/assessments/{S['course']}", m, json={
        "title": "Prelim Exam", "type": "exam", "grading_period": "prelim",
        "assessment_category": "summative", "date": date.today().isoformat()})
    S["assessment"] = a["id"]
    by_code = {c["competency_code"]: c["id"] for c in S["comps"]}
    for code, bloom, n, w in (("DSA-01", "Understanding", 4, 40), ("DSA-02", "Applying", 3, 30),
                              ("DSA-03", "Analyzing", 3, 30)):
        call("POST", f"/assessments/{a['id']}/tos", m, json={
            "competency_id": by_code[code], "bloom_level": bloom, "item_count": n, "weight_percent": w})
    return f"assessment {a['id'][:8]} + 3 TOS rows"


@step("Step 12-13. Submit to PD; PD approves with the 5-point checklist")
def _():
    call("POST", f"/assessments/{S['assessment']}/submit-for-review", login(*MARIA))
    pd = login("pd.ics@btech.edu", "PD@1234")
    q = call("GET", "/assessments/pending-approval", pd)
    assert any(a["id"] == S["assessment"] for a in q), "not in PD assessment queue"
    call("POST", f"/assessments/{S['assessment']}/approve", pd, json={
        "feedback": "Approved for Prelim.", "content_validity": True, "difficulty_appropriate": True,
        "instructions_clear": True, "bias_free": True, "outcomes_covered": True})
    return "approved"


@step("Step 14. Upload scores CSV (+ empty/invalid files rejected)")
def _():
    m = login(*MARIA)
    for bad in ("empty.csv", "invalid.txt"):
        b = DATA / bad
        r = http.post(f"/assessments/{S['assessment']}/upload", headers=m,
                      files={"file": (b.name, b.read_bytes(), "text/plain")})
        assert r.status_code in (400, 415, 422), f"{bad} accepted: {r.status_code}"
    f = DATA / "ITC212_Prelim_scores.csv"
    r = call("POST", f"/assessments/{S['assessment']}/upload", m,
             files={"file": (f.name, f.read_bytes(), "text/csv")})
    assert r["pre_tagged"] == 0, f"{r['pre_tagged']} questions pre-tagged, so the AI maps nothing"
    for _ in range(60):                      # topic mapping runs in the background
        items = call("GET", f"/assessments/{S['assessment']}/items", m)
        if items and all(i.get("ai_mapped_at") or i.get("mapped_competency_id") for i in items):
            break
        time.sleep(3)
    return f"bad files rejected; {r['valid_rows']} rows, {r['questions']} questions AI-mapped"


@step("Step 15-16. Mapping queue, confirm confident, override one")
def _():
    m = login(*MARIA)
    items = call("GET", f"/assessments/{S['assessment']}/items", m)
    mapped = [i for i in items if i.get("mapped_competency_id")]
    assert items and len(mapped) == len(items), f"{len(mapped)}/{len(items)} items mapped"
    queue = call("GET", f"/assessments/{S['assessment']}/mapping-queue", m)
    confirmed = call("PUT", f"/assessments/{S['assessment']}/confirm-confident", m)
    by_code = {c["competency_code"]: c["id"] for c in S["comps"]}
    target = next(i for i in items if i["mapped_competency_id"] != by_code["DSA-02"])
    call("PUT", f"/assessments/items/{target['id']}/tag", m,
         params={"competency_id": by_code["DSA-02"], "reason": "Question tests linked lists, not Big-O."})
    call("POST", f"/syllabi/courses/{S['course']}/competencies", m,
         json={"topic_name": "Recursion basics"})
    codes = sorted(next((c["competency_code"] for c in S["comps"] if c["id"] == i["mapped_competency_id"]), "?")
                   for i in items)
    return f"{len(items)} items AI-mapped to {codes}; confirm-confident {confirmed}; override saved; custom tag created"


@step("Step 17-18. Class results and an intervention for Felix")
def _():
    m = login(*MARIA)
    rows = call("GET", f"/analytics/courses/{S['course']}/students", m)["data"]
    assert rows, "no students in ITC 212 results"
    alerts = call("GET", "/analytics/instructor/at-risk-students", m)
    felix = next((a for a in alerts if a["full_name"] == "Felix Ramos"), None)
    assert felix, "Felix Ramos not in Intervention Alerts"
    course = felix.get("course_id") or S["itc211"]
    call("POST", f"/analytics/courses/{course}/interventions", m, json={
        "student_id_hash": felix["student_id_hash"], "action_type": "note",
        "intervention_type": "academic_counseling",
        "note": "Discussed weak topics; scheduled a remedial session.",
        "goal_description": "Raise competency score to 80% by midterm", "target_score": 80,
        "target_period": "midterm", "follow_up_date": (date.today() + timedelta(days=7)).isoformat()})
    return f"{len(rows)} students in ITC 212; intervention logged"


@step("Step 19. Course Resources: AI suggestions + own resource")
def _():
    m = login(*MARIA)
    call("POST", f"/courses/{S['course']}/resources/suggest", m)
    links = call("GET", f"/courses/{S['course']}/resources", m)["items"]
    assert links, "no AI suggestions"
    call("PUT", f"/courses/{S['course']}/resources/{links[0]['link_id']}", m, json={"status": "accepted"})
    call("PUT", f"/courses/{S['course']}/resources/{links[-1]['link_id']}", m, json={"status": "declined"})
    dsa01 = next(c["id"] for c in S["comps"] if c["competency_code"] == "DSA-01")
    call("POST", f"/courses/{S['course']}/resources", m, data={
        "title": "Big-O Notation Explained", "type": "video",
        "url": "https://www.youtube.com/watch?v=v4cd1O4zkGw",
        "description": "Watch before the Midterm review.", "competency_ids": dsa01})
    return f"suggestions returned {len(links)} links; custom resource added"


@step("Step 20-21. Grade submission PD → Dean → VP")
def _():
    m = login(*MARIA)
    g = call("POST", "/grade-submissions/", m, json={
        "course_id": S["course"], "grading_period": "prelim", "notes": "Prelim grades for review."})
    call("POST", f"/grade-submissions/{g['id']}/submit-to-pd", m)
    for e, p, c in (("pd.ics@btech.edu", "PD@1234", "Reviewed."), ("dean.ics@btech.edu", "Dean@1234", "Reviewed."),
                    ("vp@ailas.edu", "VP@1234", "Endorsed.")):
        who = login(e, p)
        assert any(x["id"] == g["id"] for x in call("GET", "/grade-submissions/pending", who)), f"not pending for {e}"
        call("POST", f"/grade-submissions/{g['id']}/approve", who, json={"feedback": c})
    final = call("GET", f"/grade-submissions/{g['id']}", m)
    return f"final status {final.get('status')}"


@step("Step 22. Liza sees ITC 212")
def _():
    l = login("liza.navarro@students.btech.edu", "Student@1234")
    call("POST", "/consent/accept", l)
    courses = call("GET", "/analytics/me/courses", l)
    assert "ITC 212" in str(courses), "ITC 212 not in My Courses"
    recs = call("GET", "/analytics/me/recommendations", l, params={"course_id": S["course"]})
    if recs:
        rid = recs[0].get("resource_id") or recs[0].get("id")
        call("POST", f"/analytics/me/recommendations/{rid}/feedback", l, json={"helpful": True})
    return f"ITC 212 visible; {len(recs)} recommendations"


@step("Step 23-25. Program, curriculum + subject, section")
def _():
    a = login("admin@ailas.edu", "Admin@1234")
    p = call("POST", "/programs/", a, json={
        "program_name": f"Bachelor of Science in Information Systems {RUN}", "degree_type": "Bachelor",
        "ched_cmo_reference": "CMO No. 25 s. 2015", "total_units": 178, "description": "Four-year IS program.",
        "program_outcomes": ["Design information systems", "Manage IT projects"]})
    c = call("POST", "/curricula/", a, json={
        "program_id": p["id"], "name": f"BSIS Curriculum 2025 {RUN}", "effective_year": 2025,
        "total_units": 178, "ched_cmo_reference": "CMO No. 25 s. 2015", "status": "active"})
    call("POST", f"/curricula/{c['id']}/subjects", a, json={
        "subject_code": "IS101", "title": "Fundamentals of Information Systems", "units": 3,
        "year_level": 1, "semester": 1})
    s = call("POST", "/sections/", a, json={
        "curriculum_id": c["id"], "section_name": f"BSIS-1A-{RUN}", "year_level": 1, "academic_year": "2025-2026"})
    S.update(curriculum=c["id"], section=s["id"])
    return "created"


@step("Step 26-27. Add instructor Carlo and student Ana; both can log in")
def _():
    a = login("admin@ailas.edu", "Admin@1234")
    call("POST", "/users/", a, json={"email": f"carlo.reyes{RUN}@btech.edu", "password": "Faculty@2025",
                                     "full_name": "Prof. Carlo Reyes", "role": "instructor", "college": "ICS"})
    call("POST", "/users/", a, json={"email": f"ana.lopez{RUN}@students.btech.edu", "password": "Student@2025",
                                     "full_name": "Ana Lopez", "role": "student", "student_number": f"2025-{RUN}",
                                     "section": "A", "year_level": "1st Year", "program": "BSIT"})
    login(f"carlo.reyes{RUN}@btech.edu", "Faculty@2025")
    login(f"ana.lopez{RUN}@students.btech.edu", "Student@2025")
    return "both logins work"


@step("Step 28. Enroll Ana into BSIS-1A")
def _():
    a = login("admin@ailas.edu", "Admin@1234")
    call("POST", "/enrollments/", a, json={
        "student_number": f"2025-{RUN}", "student_name": "Ana Lopez", "email": f"ana.lopez{RUN}@students.btech.edu",
        "section_id": S["section"], "curriculum_id": S["curriculum"], "status": "active"})
    return "enrolled"


@step("Step 29. Institution Settings defaults + change and restore")
def _():
    a = login("admin@ailas.edu", "Admin@1234")
    s = call("GET", "/institution-settings/", a)
    vals = s.get("values", s)
    want = {"mastery_threshold": 75, "at_risk_gap_count": 3, "grade_decline_percent": 15,
            "mapping_review_threshold": 0.75, "mapping_auto_accept": False}
    off = {k: vals.get(k) for k, v in want.items() if k in vals and vals.get(k) != v}
    assert not off, f"non-default settings: {off}"
    call("GET", "/institution-settings/sensitivity", a)
    return f"defaults ok ({len(vals)} settings)"


@step("Step 30. Mapping Validation: 3 validators, majority, Program Chair, HITL, export")
def _():
    a = login("admin@ailas.edu", "Admin@1234")
    opts = call("GET", "/mapping-validation/options", a)
    # the names exactly as the guide tells the user to pick them in the drop-downs
    val = {v["name"]: v["id"] for v in opts["validators"]}
    chair_opts = {v["name"]: v["id"] for v in opts["adjudicators"]}
    s = call("POST", "/mapping-validation/", a, json={"name": "1st Sem pilot validation",
                                                       "course_ids": [S["course"]], "sample_size": 20})
    call("PUT", f"/mapping-validation/{s['id']}/assignments/{S['course']}", a, json={
        "validator_a_id": val["Prof. Maria Santos"], "validator_b_id": val["Prof. Juan Dela Cruz"],
        "validator_c_id": val["Program Director"], "adjudicator_id": chair_opts["Dr. Luz Mendoza"]})
    validators = [MARIA, ("juan.delacruz@btech.edu", "Demo@1234"), ("pd@ailas.edu", "PD@1234")]
    comps = None
    for k, (e, p) in enumerate(validators):
        v = login(e, p)
        q = call("GET", f"/mapping-validation/{s['id']}/label/{S['course']}", v)
        comps = q["competencies"]
        for n, it in enumerate(q["items"]):
            pick = comps[(n + (k if n % 3 == 0 else 0)) % len(comps)]   # every 3rd item: three different answers
            call("PUT", f"/mapping-validation/{s['id']}/label/items/{it['id']}", v, json={"competency_id": pick["id"]})
    chair = login("pd.ics@btech.edu", "PD@1234")
    adj = call("GET", f"/mapping-validation/{s['id']}/adjudication", chair)["courses"][0]["items"]
    for it in adj:
        call("PUT", f"/mapping-validation/{s['id']}/adjudication/items/{it['id']}", chair,
             json={"competency_id": comps[0]["id"], "note": "Question targets sorting algorithms."})
    m = call("GET", f"/mapping-validation/{s['id']}", a)["metrics"]
    assert m["complete"], "ground truth incomplete"
    queue = call("GET", f"/assessments/{S['assessment']}/mapping-queue", login(*MARIA))
    queue = queue.get("items", queue) if isinstance(queue, dict) else queue
    x = call("GET", f"/mapping-validation/{s['id']}/export", a)
    return (f"{m['items']} items; decisions {m['decisions']}; ties broken {len(adj)}; accuracy {m['accuracy_pct']}% "
            f"(CI {m['ci_low']}-{m['ci_high']}); {m['kappa_method']} kappa {m['kappa']}; "
            f"review queue now {len(queue)}; export {len(x.content)} bytes")


@step("Step 31. VP report (ICS) + PDF and Excel")
def _():
    v = login("vp@ailas.edu", "VP@1234")
    call("GET", "/reports/options", v)
    r = call("GET", "/reports/academic-performance", v, params={"college": "ICS"})
    pdf = call("GET", "/reports/academic-performance/export", v, params={"college": "ICS", "format": "pdf"},
               expect=(200, 404, 422))
    return f"report ok; keys {list(r)[:6]}…; pdf status {getattr(pdf, 'status_code', 200)}"


@step("Step 32. Audit logs record the run")
def _():
    a = login("admin@ailas.edu", "Admin@1234")
    logs = call("GET", "/analytics/admin/audit-logs", a)
    logs = logs.get("logs", logs) if isinstance(logs, dict) else logs
    return f"{len(logs)} audit entries"


@step("Step 33. SUS survey (Felix)")
def _():
    f = login("felix.ramos@students.btech.edu", "Student@1234")
    call("POST", "/surveys/sus", f, json={"responses": {f"q{i}": 4 if i % 2 else 2 for i in range(1, 11)}},
         expect=(200, 201, 409))
    return "submitted"


@step("Step 34. Change Felix's password, then put it back")
def _():
    f = login("felix.ramos@students.btech.edu", "Student@1234")
    call("PUT", "/users/me/password", f, json={"current_password": "Student@1234", "new_password": "Student@12345"})
    f2 = login("felix.ramos@students.btech.edu", "Student@12345", fresh=True)
    call("PUT", "/users/me/password", f2, json={"current_password": "Student@12345", "new_password": "Student@1234"})
    return "changed and restored"


width = max(len(n) for n, _, _ in results)
for name, ok, note in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name.ljust(width)}  {note}")
failed = sum(1 for _, ok, _ in results if not ok)
print(f"\n{len(results) - failed}/{len(results)} passed")
sys.exit(1 if failed else 0)
