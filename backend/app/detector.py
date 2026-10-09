"""Deterministic, zero-cost question detection. Ambiguous text returns 'AMBIGUOUS' (-> LLM)."""
import re
from difflib import SequenceMatcher

QUESTION_TYPES = {"QUESTION", "FOLLOW_UP_QUESTION", "CLARIFICATION_QUESTION", "BEHAVIORAL_QUESTION",
                  "TECHNICAL_QUESTION", "CODING_QUESTION", "SYSTEM_DESIGN_QUESTION", "RESUME_QUESTION"}

_REPHRASE = re.compile(r"(?:actually,?\s*|sorry,?\s*)?(?:let me (?:rephrase|re-?ask|ask (?:that|it) (?:differently|another way))|scratch that)[^.?!…]*[.?!…:,]*\s*", re.I)
_LEAD = re.compile(r"^(?:(?:okay|ok|alright|all right|great|right|so|well|um|uh|now|and)\b[ ,.!]*)+", re.I)
_FILLER = {"hello", "hi", "hey", "thanks", "thank you", "yes", "no", "sure", "exactly", "excellent", "perfect",
           "nice", "cool", "good", "got it", "i see", "interesting", "thats interesting", "that's interesting",
           "sounds good", "let's continue", "let's move on", "let's get started", "thanks for joining",
           "thank you for joining", "thanks for coming", "mm hmm", "uh huh", "that makes sense", "understood"}
_SMALLTALK = re.compile(r"^(?:(?:hi|hello|hey)\b[ ,.!]*)?(?:how are you|how's it going|how is your day|how's your day|how are things)\b[^.?!]*[.?!]*$", re.I)
_FOLLOW = re.compile(r"^(?:what|how) about\b|^why not\b|^(?:can|could) you (?:elaborate|expand)|^what else\b", re.I)
_Q_START = re.compile(r"^(?:what|why|how|when|where|who|which|can you|could you|would you|will you|do you|did you|does|have you|has|are you|were you|is there|should|tell me|walk me through|describe|explain|talk (?:to me )?about|give me|show me|i(?:'d| would) (?:like|love) (?:you )?to|i(?:'m| am) curious|i want to (?:know|hear)|please (?:explain|describe|tell))\b", re.I)
_DANGLING = {"and", "the", "a", "an", "to", "of", "that", "how", "what", "why", "you", "your", "with", "in", "on", "for",
             "would", "could", "can", "is", "are", "do", "did", "about", "or", "but", "if", "so", "we", "i", "like", "when", "where"}


def clean(text: str) -> str:
    """Normalise apostrophes; if the interviewer self-corrected, keep only what follows the correction."""
    text = text.replace("’", "'").strip()
    ms = list(_REPHRASE.finditer(text))
    if ms:
        rest = text[ms[-1].end():].strip()
        return rest if re.search(r"\w", rest) else ""
    return text


def is_correction(text: str) -> bool:
    return bool(_REPHRASE.search(text.replace("’", "'")))


def _qtype(t: str) -> str:
    t = t.lower()
    if re.search(r"\b(write|implement|algorithm|function|leetcode|time complexity|code)\b", t): return "CODING_QUESTION"
    if re.search(r"\b(design|architect\w*|scale|scalable|scaling)\b", t): return "SYSTEM_DESIGN_QUESTION"
    if re.search(r"tell me about a time|describe a (time|situation)|difficult|challeng\w+|conflict|disagree\w*|failure|weakness|strength|proud", t): return "BEHAVIORAL_QUESTION"
    if re.search(r"\byour (resume|experience|background|projects?|role)\b|you (worked|built|developed|implemented|designed)|walk me through", t): return "RESUME_QUESTION"
    if re.search(r"\b(sql|query|python|docker|redis|kubernetes|api|database|model|index|cache|postgres\w*|fastapi|react)\b", t): return "TECHNICAL_QUESTION"
    return "QUESTION"


def local_classify(text: str) -> tuple[str, float]:
    t = clean(text)
    if not re.search(r"\w", t): return "INCOMPLETE", 0.99
    if t.endswith(("...", "…")): return "INCOMPLETE", 0.9
    body = _LEAD.sub("", t).strip()
    norm = re.sub(r"[^\w' ]", "", body.lower()).strip()
    if not norm or norm in _FILLER: return "ACKNOWLEDGEMENT", 0.99
    if _SMALLTALK.match(body): return "SMALL_TALK", 0.95
    if _FOLLOW.match(body): return "FOLLOW_UP_QUESTION", 0.9
    if t[-1] not in ".?!" and norm.split()[-1] in _DANGLING: return "INCOMPLETE", 0.8
    for s in re.split(r"(?<=[.?!])\s+", body):
        s = s.strip()
        if _Q_START.match(s): return _qtype(body), 0.95
        if s.endswith("?"): return _qtype(body), 0.85
    return "AMBIGUOUS", 0.0


def similar(a: str, b: str) -> float:
    n = lambda s: re.sub(r"[^\w ]", "", s.lower()).strip()
    return SequenceMatcher(None, n(a), n(b)).ratio()
