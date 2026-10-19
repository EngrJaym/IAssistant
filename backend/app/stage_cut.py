"""Split a live utterance when the user stages the part heard so far."""
from __future__ import annotations

import re

from .detector import QUESTION_TYPES, local_classify, similar

_WORD = re.compile(r"[A-Za-z0-9']+")


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def merge_gather(buffer: str, partial: str) -> str:
    """Join committed transcript and the live partial without repeating either."""
    buf = (buffer or "").strip()
    part = (partial or "").strip()
    if not buf:
        return part
    if not part:
        return buf
    bw, pw = words(buf), words(part)
    if pw and bw and pw[: len(bw)] == bw:
        return part
    if bw and pw and bw[: len(pw)] == pw:
        return buf
    if similar(buf, part) >= 0.9:
        return part if len(pw) >= len(bw) else buf
    return f"{buf} {part}".strip()


def worth_staging(text: str) -> bool:
    body = (text or "").strip()
    if not body:
        return False
    label, _ = local_classify(body)
    if label in ("ACKNOWLEDGEMENT", "SMALL_TALK"):
        return False
    count = len(words(body))
    if count >= 3:
        return True
    return count >= 2 and label in QUESTION_TYPES


def after_cut(final: str, cut: str) -> str:
    """Drop the staged prefix from a later final. Unrelated speech is kept whole."""
    final = (final or "").strip()
    cut = (cut or "").strip()
    if not final or not cut:
        return final
    fw, cw = words(final), words(cut)
    if not fw or not cw:
        return final
    if similar(final, cut) >= 0.88 and len(fw) <= len(cw) + 2:
        return ""
    shared = 0
    while shared < len(fw) and shared < len(cw) and fw[shared] == cw[shared]:
        shared += 1
    if shared < max(2, int(len(cw) * 0.6)):
        return final
    marks = list(_WORD.finditer(final))
    if shared >= len(marks):
        return ""
    return final[marks[shared].start():].strip(" ,;:")


def peel_cuts(final: str, cuts: list[str]) -> str:
    rest = (final or "").strip()
    for cut in cuts:
        if not rest:
            return ""
        rest = after_cut(rest, cut)
    return rest.strip()
