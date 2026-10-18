import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from app import main
from app import session_ws
from app.transcript_merge import merge_chunk_text
from app.turn_router import route_turn


def test_only_interviewer_questions_are_answerable():
    assert route_turn("What is Docker?", "QUESTION").should_answer is True
    assert route_turn("I used Docker to ship the API.", "AMBIGUOUS").should_answer is False
    assert route_turn("How old are you?", "QUESTION").should_answer is False


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
        await s.process("I would package the service with Docker and deploy it on Kubernetes.", "AMBIGUOUS", 0.4)
        await s.process("How old are you?", "QUESTION", 0.95)
        await s.process("What is Docker?", "QUESTION", 0.95)
        if s.gen:
            await s.gen
        return ws.ev

    ev = asyncio.run(go())
    types = [e["type"] for e in ev]
    assert types.count("answer_start") == 1
    skipped = [e for e in ev if e["type"] == "transcript_skipped"]
    assert {e["reason"] for e in skipped} >= {"candidate_speech", "personal_question"}
