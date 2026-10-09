"""Conservative speaker routing for hands-free QA (not ML diarization)."""

from __future__ import annotations

INTERVIEWER = "interviewer"
CANDIDATE = "candidate"
UNKNOWN = "unknown"

_CANDIDATE_NAMES = frozenset({"you", "candidate", "me"})
_INTERVIEWER_NAMES = frozenset({"interviewer", "host", "recruiter"})


def role(speaker: str | None) -> str:
    s = (speaker or "").strip().lower()
    if s in _INTERVIEWER_NAMES:
        return INTERVIEWER
    if s in _CANDIDATE_NAMES:
        return CANDIDATE
    if s.startswith("participant"):
        return UNKNOWN
    if s == "other" or not s:
        return UNKNOWN
    return UNKNOWN


def should_run_question_pipeline(speaker: str | None, hands_free: bool) -> tuple[bool, str]:
    """
    Returns (allowed, reason). In hands-free mode only labelled interviewer speech
    may trigger answers. Unknown speakers are ignored conservatively.
    """
    if not hands_free:
        return True, "manual"
    r = role(speaker)
    if r == INTERVIEWER:
        return True, "interviewer"
    if r == CANDIDATE:
        return False, "candidate_speech"
    return False, "unknown_speaker"


def speaker_status_label(speaker: str | None, hands_free: bool) -> str:
    r = role(speaker)
    if not hands_free:
        return f"Manual · active: {speaker or '—'}"
    if r == INTERVIEWER:
        return "Listening for interviewer questions"
    if r == CANDIDATE:
        return "Candidate speech — answers paused"
    return "Set active speaker to Interviewer for hands-free Q&A"
