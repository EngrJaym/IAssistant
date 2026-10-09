"""Session phase machine and utterance buffering (event-driven completion)."""
from __future__ import annotations

import asyncio
from enum import Enum

from .detector import clean, is_correction, local_classify


class Phase(str, Enum):
    IDLE = "IDLE"
    LISTENING = "LISTENING"
    WAITING_FOR_COMPLETION = "WAITING_FOR_COMPLETION"
    VALIDATING = "VALIDATING"
    ANSWERING = "ANSWERING"
    COOLDOWN = "COOLDOWN"


def ui_status(phase: Phase, legacy: str | None = None) -> str:
    """Map internal phase (+ optional legacy STT status) to UI label."""
    if legacy in ("TRANSCRIBING", "RECONNECTING"):
        return legacy
    return {
        Phase.IDLE: "READY",
        Phase.LISTENING: "LISTENING",
        Phase.WAITING_FOR_COMPLETION: "WAITING FOR COMPLETION",
        Phase.VALIDATING: "ANALYZING QUESTION",
        Phase.ANSWERING: "GENERATING",
        Phase.COOLDOWN: "ANSWER READY",
    }.get(phase, "LISTENING")


class UtteranceBuffer:
    """Accumulates transcript fragments; debounces until the interviewer likely finished."""

    def __init__(self, on_flush, on_waiting):
        self.buf = ""
        self.hold = False
        self.timer: asyncio.Task | None = None
        self.segment_id = 0
        self._on_flush = on_flush
        self._on_waiting = on_waiting

    def cancel_timer(self):
        if self.timer and not self.timer.done():
            self.timer.cancel()
        self.timer = None

    def reset(self):
        self.cancel_timer()
        self.buf, self.hold = "", False

    def ingest(self, text: str, loop: asyncio.AbstractEventLoop) -> None:
        self.cancel_timer()
        if is_correction(text):
            self.buf, text = "", clean(text)
        elif self.buf and not self.hold:
            pending, self.buf = self.buf, ""
            sid = self.segment_id
            self.segment_id += 1
            loop.create_task(self._on_flush(pending, sid))
        self.buf = f"{self.buf} {text}".strip()
        if not self.buf:
            self.hold = False
            return
        label, _ = local_classify(self.buf)
        end = self.buf[-1]
        self.hold = label == "INCOMPLETE" or end not in ".?!"
        delay = completion_delay(label, end)
        self.cancel_timer()
        loop.create_task(self._on_waiting())
        self.timer = loop.create_task(self._fire(delay))

    async def _fire(self, delay: float):
        await asyncio.sleep(delay)
        self.hold = False
        text, self.buf = self.buf, ""
        sid = self.segment_id
        self.segment_id += 1
        await self._on_flush(text, sid)


def completion_delay(label: str, end_char: str) -> float:
    if label == "INCOMPLETE":
        return 3.0
    if end_char not in ".?!":
        return 1.2
    if end_char == "?":
        return 0.15
    return 0.55
