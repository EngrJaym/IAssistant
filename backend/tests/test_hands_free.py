import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from app import main
from app import session_ws
from app.speaker_gate import should_run_question_pipeline
from app.transcript_merge import merge_chunk_text


def test_speaker_gate_hands_free():
    assert should_run_question_pipeline("Interviewer", True) == (True, "interviewer")
    assert should_run_question_pipeline("You", True)[0] is False
    assert should_run_question_pipeline("Other", True)[0] is False
    assert should_run_question_pipeline("You", False)[0] is True


def test_merge_overlapping_chunks():
    a = "Could you explain your role in the"
    b = "your role in the deployment process"
    m = merge_chunk_text(a, b)
    assert "deployment process" in m
    assert m.lower().count("your role") <= 2


def test_candidate_speech_does_not_answer(monkeypatch):
    async def fake_stream(ctx, q, qt):
        yield "done", {"answer": "nope", "key_points": [], "follow_up": "", "confidence": "high"}

    async def go():
        monkeypatch.setattr(session_ws, "stream_answer", fake_stream)

        class WS:
            def __init__(self):
                self.ev = []

            async def send_json(self, d):
                self.ev.append(d)

        ws = WS()
        s = main.Session(ws, main._resolve_for_session, main._resolved)
        s.hands_free = True
        s.speaker = "You"
        await s.process("What is Docker?", "QUESTION", 0.95)
        return ws.ev

    ev = asyncio.run(go())
    assert "answer_start" not in [e["type"] for e in ev]
    assert any(e["type"] == "transcript_skipped" for e in ev)
