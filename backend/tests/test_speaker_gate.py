from app.speaker_gate import (
    CANDIDATE,
    INTERVIEWER,
    UNKNOWN,
    role,
    should_run_question_pipeline,
    speaker_status_label,
)


def test_role_mapping():
    assert role("Interviewer") == INTERVIEWER
    assert role("recruiter") == INTERVIEWER
    assert role("You") == CANDIDATE
    assert role("participant 1") == UNKNOWN
    assert role("") == UNKNOWN


def test_speaker_status_labels():
    assert "Manual" in speaker_status_label("You", False)
    assert speaker_status_label("Interviewer", True) == "Listening for interviewer questions"
    assert "paused" in speaker_status_label("You", True)
    assert "Set active speaker" in speaker_status_label("Other", True)


def test_manual_mode_allows_any_speaker():
    assert should_run_question_pipeline("You", False) == (True, "manual")
