import io


def test_parse_resume_rejects_txt(client):
    r = client.post(
        "/api/parse-resume",
        files={"file": ("resume.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400
    assert "PDF" in r.json()["error"]


def test_parse_resume_rejects_oversize(client):
    r = client.post(
        "/api/parse-resume",
        files={"file": ("resume.pdf", b"x" * (10 * 1024 * 1024 + 1), "application/pdf")},
    )
    assert r.status_code == 400
    assert "10 MB" in r.json()["error"]


def test_parse_resume_accepts_small_docx(client):
    import docx

    buf = io.BytesIO()
    d = docx.Document()
    d.add_paragraph("Senior engineer with FastAPI experience.")
    d.save(buf)
    r = client.post(
        "/api/parse-resume",
        files={
            "file": (
                "resume.docx",
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert r.status_code == 200
    assert "FastAPI" in r.json()["text"]
