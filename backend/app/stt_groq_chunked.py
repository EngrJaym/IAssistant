"""Near-real-time Groq Whisper via bounded overlapping audio chunks (not true streaming)."""
from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

from . import config
from .agent import client
from .providers import pcm16_to_wav
from .transcript_merge import merge_chunk_text

OnFinal = Callable[[str, int], Awaitable[None]]
OnPartial = Callable[[str], Awaitable[None]]


class GroqChunkTranscriber:
    """
    Buffers PCM16 @ 24kHz mono. Emits finals after silence or max chunk duration.
    Overlap tail is kept for the next chunk to reduce word-boundary loss.
    """

    def __init__(self, model: str, on_final: OnFinal, on_partial: OnPartial | None = None):
        self.model = model
        self.on_final = on_final
        self.on_partial = on_partial
        self.pcm = bytearray()
        self.overlap_tail = bytearray()
        self.last_voice = 0.0
        self.last_emit = ""
        self.last_final_text = ""
        self.last_final_ts = 0.0
        self._busy = False
        self._running = False
        self.rate = 24000
        self.bytes_per_ms = self.rate * 2 // 1000

    def feed(self, chunk: bytes, voice: bool):
        if voice:
            self.last_voice = time.monotonic()
        self.pcm.extend(chunk)

    async def run_loop(self):
        self._running = True
        chunk_ms = int(config.GROQ_CHUNK_SECONDS * 1000)
        overlap_ms = config.GROQ_CHUNK_OVERLAP_MS
        silence_ms = config.GROQ_CHUNK_SILENCE_MS
        min_ms = 400
        try:
            while self._running:
                await asyncio.sleep(0.15)
                if self._busy or not self.pcm:
                    continue
                age = time.monotonic() - self.last_voice
                dur_ms = len(self.pcm) // self.bytes_per_ms
                if dur_ms < min_ms:
                    continue
                if age * 1000 < silence_ms and dur_ms < chunk_ms:
                    continue
                await self._transcribe_chunk(overlap_ms)
        except asyncio.CancelledError:
            raise

    def stop(self):
        self._running = False

    async def _transcribe_chunk(self, overlap_ms: int):
        self._busy = True
        pcm = bytes(self.overlap_tail) + bytes(self.pcm)
        self.pcm.clear()
        overlap_bytes = overlap_ms * self.bytes_per_ms
        if overlap_bytes > 0 and len(pcm) > overlap_bytes:
            self.overlap_tail = bytearray(pcm[-overlap_bytes:])
            pcm = pcm[:-overlap_bytes]
        else:
            self.overlap_tail.clear()
        try:
            wav = pcm16_to_wav(pcm)
            tr = await client("groq").audio.transcriptions.create(
                model=self.model,
                file=("speech.wav", wav, "audio/wav"),
                language="en",
            )
            text = (tr.text or "").strip()
        except Exception:
            self._busy = False
            return
        if text:
            merged = merge_chunk_text(self.last_emit, text)
            self.last_emit = merged
            if self.on_partial:
                await self.on_partial(merged)
            now = time.monotonic()
            from .transcript_merge import dedupe_final

            if not dedupe_final(merged, self.last_final_text, last_ts=self.last_final_ts, now=now):
                self.last_final_text = merged
                self.last_final_ts = now
                ts = int(time.time() * 1000)
                await self.on_final(merged, ts)
                self.last_emit = ""
        self._busy = False
