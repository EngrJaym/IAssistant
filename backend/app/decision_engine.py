"""Turn-taking: whether an utterance should produce a visible suggested answer."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from . import config
from .detector import QUESTION_TYPES

HIGH = float(getattr(config, "DECISION_HIGH", 0.85))
MED = float(getattr(config, "DECISION_MED", 0.60))

_RHETORICAL = (
    "i wonder",
    "i was wondering",
    "it would be interesting",
    "i'm curious if",
    "im curious if",
    "not sure if",
    "hard to say",
)


@dataclass
class TurnDecision:
    intent: str
    target: str
    turn_complete: bool
    should_answer: bool
    confidence: float
    reason: str
    tier: str  # high | medium | low
    speaker: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _intent_from_label(label: str, text: str) -> str:
    t = text.lower()
    if label == "INCOMPLETE":
        return "incomplete"
    if label in ("ACKNOWLEDGEMENT", "SMALL_TALK"):
        return "small_talk"
    if label == "STATEMENT" or label == "IRRELEVANT":
        return "statement"
    if label == "AMBIGUOUS":
        return "unknown"
    if any(p in t for p in _RHETORICAL) and "?" not in text[-3:]:
        return "rhetorical"
    if label == "FOLLOW_UP_QUESTION":
        return "follow_up"
    if label in QUESTION_TYPES:
        return "direct_question"
    return "unknown"


def _target(speaker: str, hands_free: bool) -> str:
    s = (speaker or "").strip().lower()
    if hands_free:
        return "candidate" if s == "interviewer" else "other"
    return "candidate" if s in ("interviewer", "participant 1", "participant 2", "other", "") else "other"


def evaluate_turn(
    text: str,
    speaker: str,
    hands_free: bool,
    label: str,
    classifier_conf: float,
    turn_complete: bool,
    mode: str = "balanced",
) -> TurnDecision:
    intent = _intent_from_label(label, text)
    target = _target(speaker, hands_free)
    conf = float(classifier_conf)

    if intent == "direct_question" or intent == "follow_up":
        conf = max(conf, 0.88 if "?" in text else 0.82)
    elif intent == "rhetorical":
        conf = min(conf, 0.55)
    elif intent in ("statement", "small_talk"):
        conf = max(conf, 0.92)

    if target != "candidate":
        conf = min(conf, 0.35)
    if not turn_complete:
        conf = min(conf, 0.45)
        intent = "incomplete" if intent != "incomplete" else intent

    th = {"normal": max(config.THRESHOLD, 0.9), "balanced": config.THRESHOLD, "aggressive": 0.5}.get(
        mode, config.THRESHOLD
    )
    answer_th = max(th, HIGH) if mode == "normal" else HIGH if mode == "balanced" else MED

    should = (
        turn_complete
        and target == "candidate"
        and intent in ("direct_question", "follow_up")
        and label in QUESTION_TYPES
        and conf >= answer_th
    )

    if conf >= answer_th and should:
        tier, reason = "high", "Direct question to candidate; turn complete"
    elif conf >= MED and intent in ("direct_question", "follow_up", "unknown", "rhetorical"):
        tier = "medium"
        reason = "Possible question — gathering more context"
        should = False
    else:
        tier = "low"
        reason = _suppress_reason(intent, target, turn_complete)

    return TurnDecision(
        intent=intent,
        target=target,
        turn_complete=turn_complete,
        should_answer=should,
        confidence=round(conf, 3),
        reason=reason,
        tier=tier,
        speaker=speaker or "Unknown",
    )


def _suppress_reason(intent: str, target: str, turn_complete: bool) -> str:
    if target != "candidate":
        return "Not interviewer / not directed at you"
    if not turn_complete:
        return "Utterance still in progress"
    if intent == "statement":
        return "Interviewer statement or context, not a question"
    if intent == "small_talk":
        return "Greeting or filler"
    if intent == "rhetorical":
        return "Thinking aloud or rhetorical — waiting"
    if intent == "incomplete":
        return "Incomplete thought"
    return "Low confidence — keep listening"
