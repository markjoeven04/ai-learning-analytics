"""Admin actions that used to fail: program/section delete with dependants (500) and
resource edit / bulk import (405)."""
from backend.models.curriculum import Curriculum
from backend.models.program import Program
from backend.models.resource import Resource
from backend.models.section import Section


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_delete_program_or_section_in_use_is_refused_with_reason(client, db, admin_token):
    prog = Program(program_name="BSIT", degree_type="BS", total_units=150)
    db.add(prog)
    db.flush()
    cur = Curriculum(program_id=prog.id, name="BSIT 2024", effective_year=2024, total_units=150)
    db.add(cur)
    db.flush()
    sec = Section(curriculum_id=cur.id, section_name="BSIT 2A", year_level=2, academic_year="2025-2026")
    db.add(sec)
    db.commit()
    r = client.delete(f"/programs/{prog.id}", headers=_auth(admin_token))
    assert r.status_code == 409 and "BSIT 2024" in r.json()["detail"]
    empty = client.delete(f"/sections/{sec.id}", headers=_auth(admin_token))
    assert empty.status_code == 204  # nothing enrolled, nothing linked: still deletable


def test_edit_and_bulk_import_resources(client, db, admin_token):
    res = Resource(title="Old", type="video", url="https://a.example", competency_tags=[])
    db.add(res)
    db.commit()
    body = {"title": "New", "type": "reading", "url": "https://a.example", "competency_tags": ["DSA-01"],
            "description": "notes"}
    r = client.put(f"/analytics/resources/{res.id}", headers=_auth(admin_token), json=body)
    assert r.status_code == 200 and r.json()["title"] == "New" and r.json()["description"] == "notes"

    csv = b'title,type,url,competency_tags\nSQL intro,video,https://b.example,"DBMS-02,sql"\nDup,video,https://a.example,\nBad,podcast,https://c.example,\n'
    r = client.post("/analytics/resources/bulk-import", headers=_auth(admin_token),
                    files={"file": ("r.csv", csv, "text/csv")})
    assert r.status_code == 200
    assert r.json()["imported"] == 1 and r.json()["skipped"] == 1 and len(r.json()["errors"]) == 2
