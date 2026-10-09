import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import db


def test_memory_storage_by_default(monkeypatch):
    monkeypatch.setattr(db.config, "DATABASE_URL", "")
    db.reset_memory()
    assert db.backend() == "memory"
    assert db.enabled() is True
    assert db.ping() is True
    mid = db.create_meeting("free", "ollama", "browser")
    assert mid
    db.add_line(mid, "Interviewer", "What is Docker?", 1_700_000_000_000)
    listed = db.list_meetings()
    assert len(listed) == 1 and listed[0]["line_count"] == 1
    full = db.get_meeting(mid)
    assert full and len(full["lines"]) == 1
    assert db.delete_meeting(mid)
