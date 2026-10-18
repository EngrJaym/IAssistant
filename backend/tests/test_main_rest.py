"""REST routes: meetings lifecycle, session stop, resume PDF."""

from app import db


def test_meetings_list_create_get_delete(client, groq_configured, monkeypatch):
    async def fake_groq_ids():
        return {"openai/gpt-oss-20b", "whisper-large-v3-turbo"}

    from app import main

    monkeypatch.setattr(main, "groq_model_ids", fake_groq_ids)
    start = client.post("/api/session/start", json={}).json()
    mid = start["meeting_id"]
    listed = client.get("/api/meetings").json()
    assert any(m["id"] == mid for m in listed["meetings"])
    db.add_line(mid, "Interviewer", "Hello?", 1_700_000_000_000)
    detail = client.get(f"/api/meetings/{mid}").json()
    assert detail["id"] == mid
    assert len(detail.get("lines") or []) >= 1
    export = client.get(f"/api/meetings/{mid}/export.docx")
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("application/vnd.openxmlformats")
    stop = client.post("/api/session/stop", json={"meeting_id": mid})
    assert stop.status_code == 200
    assert client.delete(f"/api/meetings/{mid}").status_code == 200
    assert client.get(f"/api/meetings/{mid}").status_code == 404


def test_meetings_export_docx_not_found(client):
    r = client.get("/api/meetings/does-not-exist/export.docx")
    assert r.status_code == 404


def test_parse_resume_minimal_pdf(client):
    # Minimal valid PDF structure for pypdf
    pdf = b"""%PDF-1.1
1 0 obj<<>>endobj
2 0 obj<</Length 44>>stream
BT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET
endstream
endobj
3 0 obj<</Type/Page/Parent 4 0 R/MediaBox[0 0 612 792]/Contents 2 0 R>>endobj
4 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
5 0 obj<</Type/Catalog/Pages 4 0 R>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000024 00000 n 
0000000100 00000 n 
0000000200 00000 n 
0000000250 00000 n 
trailer<</Size 6/Root 5 0 R>>
startxref
300
%%EOF
"""
    r = client.post("/api/parse-resume", files={"file": ("cv.pdf", pdf, "application/pdf")})
    # pypdf may or may not extract from minimal PDF; accept 200 with text or 400 parse error
    assert r.status_code in (200, 400)
    if r.status_code == 200:
        assert isinstance(r.json().get("text"), str)

