"""Merge overlapping chunked transcription results."""
from __future__ import annotations

import re
from difflib import SequenceMatcher


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().strip())


def merge_chunk_text(previous: str, new: str) -> str:
    """Join two consecutive chunk transcripts, dropping duplicated overlap."""
    previous, new = previous.strip(), new.strip()
    if not previous:
        return new
    if not new:
        return previous
    if new in previous or _norm(new) in _norm(previous):
        return previous
    if previous in new:
        return new
    a, b = _norm(previous), _norm(new)
    best, best_len = 0, 0
    max_overlap = min(len(a), len(b), 120)
    for n in range(max_overlap, 8, -1):
        if a[-n:] == b[:n]:
            best_len = n
            break
    if best_len:
        return (previous + " " + new[best_len:]).strip()
    if SequenceMatcher(None, a.split()[-6:], b.split()[:6]).ratio() > 0.72:
        return (previous + " " + new).strip()
    return f"{previous} {new}".strip()


def dedupe_final(text: str, last: str, within_sec: float = 3.0, last_ts: float = 0, now: float = 0) -> bool:
    """True if this final should be dropped as duplicate."""
    if not last:
        return False
    if now and last_ts and now - last_ts > within_sec:
        return False
    return SequenceMatcher(None, _norm(text), _norm(last)).ratio() > 0.92
