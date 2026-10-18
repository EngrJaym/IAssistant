import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.decision_engine import evaluate_turn


def test_direct_question_high_confidence():
    d = evaluate_turn("How would you deploy this to production?", "Interviewer", True, "QUESTION", 0.95, True)
    assert d.should_answer is True
    assert d.target == "candidate"
    assert d.tier == "high"


def test_statement_suppressed():
    d = evaluate_turn("We process millions of records every day.", "Interviewer", True, "AMBIGUOUS", 0.0, True)
    d = evaluate_turn("We process millions of records every day.", "Interviewer", True, "STATEMENT", 0.9, True)
    assert d.should_answer is False
    assert d.intent == "statement"


def test_candidate_speech_not_targeted():
    d = evaluate_turn("What is Docker?", "You", True, "QUESTION", 0.95, True)
    assert d.should_answer is False
    assert d.target == "other"


def test_personal_question_not_answered():
    d = evaluate_turn("How old are you?", "Interviewer", True, "QUESTION", 0.95, True, personal=True)
    assert d.should_answer is False
    assert d.intent == "personal"
