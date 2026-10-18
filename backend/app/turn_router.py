"""Decide whether a transcript turn is an interviewer question we should answer.

There is no speaker diarization. The decision uses the words themselves:
answer a completed interviewer question, and ignore personal questions plus
speech that is the candidate answering.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .detector import QUESTION_TYPES, clean, similar

_PERSONAL = re.compile(
    r"\b(?:"
    r"how old are you|what(?:'s| is) your age|when were you born|date of birth|what year were you born|"
    r"marital status|are you married|have you ever been married|are you single|are you dating|"
    r"do you have a (?:boyfriend|girlfriend|partner|spouse|husband|wife)|relationship status|"
    r"do you have (?:any )?(?:kids|children)|have you got (?:any )?(?:kids|children)|"
    r"are you pregnant|planning (?:on |to )have (?:kids|children)|"
    r"your (?:kids|children|family|spouse|husband|wife|parents|personal life)|"
    r"tell me about your (?:family|kids|children|spouse|husband|wife|parents|personal life)|"
    r"your religion|religious beliefs|what faith|do you (?:go to|attend) church|"
    r"are you (?:christian|muslim|jewish|hindu|catholic|atheist)|"
    r"political (?:views|party|affiliation)|who (?:did|do) you vote|are you a (?:democrat|republican)|"
    r"sexual orientation|gender identity|are you gay|are you straight|"
    r"disability|medical condition|health problems|mental illness|"
    r"where were you born|where are you (?:originally )?from|what country are you from|"
    r"what(?:'s| is) your (?:race|ethnicity|nationality|address)|where do you live|home address|"
    r"are you a citizen|"
    r"current salary|salary history|how much (?:do|did) you (?:currently )?(?:make|earn)|"
    r"what do you (?:currently )?(?:make|earn)|what(?:'s| is) your (?:current )?salary"
    r")\b",
    re.I,
)

# First person that is answering, not prompting ("I'd like you to...").
_CANDIDATE = re.compile(
    r"\b(?:i(?:'m| am| was| were| had| would| used| built| worked| think| use| did| handled)|"
    r"i have (?:worked|used|built|done|been|implemented|experience)|"
    r"my (?:experience|approach|background|team|role|last|previous)|"
    r"in my |we (?:used|built|implemented|had|decided|chose)|"
    r"the way i |what i (?:did|would|built|used)|how i (?:would|did|handled|approach))\b",
    re.I,
)

_INTERVIEWER_LEAD = re.compile(
    r"\b(?:i(?:'d| would) like (?:you |to )|i want (?:you |to )|i(?:'m| am) curious|"
    r"tell me|walk me|can you|could you|would you)\b",
    re.I,
)


@dataclass(frozen=True)
class TurnRoute:
    speaker: str  # Interviewer | You
    kind: str  # interviewer_question | personal | candidate_answer | other
    should_answer: bool
    certain: bool
    reason: str


def is_personal_question(text: str) -> bool:
    return bool(_PERSONAL.search(clean(text or "")))


def route_turn(
    text: str,
    label: str,
    last_question: str = "",
    last_answer: str = "",
) -> TurnRoute:
    body = clean(text or "")
    if not body:
        return TurnRoute("Interviewer", "other", False, True, "empty")

    answer = (last_answer or "").strip()
    if answer and len(body) >= 48 and similar(body, answer) >= 0.6:
        return TurnRoute("You", "candidate_answer", False, True, "candidate_reading_answer")

    candidate = _looks_like_candidate(body)
    question = label in QUESTION_TYPES
    if is_personal_question(body) and (question or body.rstrip().endswith("?")):
        return TurnRoute("Interviewer", "personal", False, True, "personal_question")

    if question and not candidate:
        return TurnRoute("Interviewer", "interviewer_question", True, True, "interviewer_question")

    if candidate:
        return TurnRoute("You", "candidate_answer", False, True, "candidate_speech")

    if label in ("ACKNOWLEDGEMENT", "SMALL_TALK", "STATEMENT", "IRRELEVANT", "INCOMPLETE"):
        return TurnRoute("Interviewer", "other", False, True, label.lower())

    # AMBIGUOUS: let the LLM classifier decide who is speaking.
    _ = last_question
    return TurnRoute("Interviewer", "other", False, False, "needs_classifier")


def _looks_like_candidate(text: str) -> bool:
    if _INTERVIEWER_LEAD.search(text):
        return False
    return bool(_CANDIDATE.search(text))
