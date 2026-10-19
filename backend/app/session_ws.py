"""WebSocket interview session: STT bridges, utterance buffering, QA pipeline."""
import asyncio
import base64
import json
import struct
import time

import openai
from websockets.asyncio.client import connect

from . import config, db
from .agent import Context, classify, client, stream_answer
from .detector import QUESTION_TYPES, clean, local_classify, similar
from .decision_engine import evaluate_turn
from .session_flow import Phase, UtteranceBuffer, ui_status
from .speaker_gate import speaker_status_label
from .stage_cut import merge_gather, peel_cuts, words, worth_staging
from .turn_router import is_personal_question, route_turn
from .stt_groq_chunked import GroqChunkTranscriber
from .transcript_merge import dedupe_final

STT_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
BAD_OPENAI = "The OpenAI API key appears to be invalid."
BAD_GROQ = "The Groq API key appears to be invalid."
NO_OPENAI = "OPENAI_API_KEY is not configured."
NO_GROQ = "GROQ_API_KEY is not configured."
VOICE_RMS = 0.012


def _pcm_voice(chunk: bytes) -> bool:
    n = len(chunk) // 2
    if n < 64:
        return False
    samples = struct.unpack(f"<{n}h", chunk[: n * 2])
    s = sum(x * x for x in samples) / n
    return (s ** 0.5) / 32768 > VOICE_RMS


class Session:
    def __init__(self, ws, resolve_for_session, resolved):
        self.ws = ws  # FastAPI WebSocket or test double
        self._resolve_for_session = resolve_for_session
        self._resolved = resolved
        self.ctx, self.mode = Context(), "balanced"
        self.up = None
        self.partial = ""
        self.jobs: asyncio.Queue = asyncio.Queue()
        self.worker = None
        self.epoch = 0
        self.queued_texts: list[str] = []
        self.cuts: list[tuple[str, float]] = []
        self.last_stage_text = ""
        self.last_stage_at = 0.0
        self.stt_mode = config.STT_PROVIDER
        self.stt_model: str | None = None
        self.stt = self.gen = None
        self.groq: GroqChunkTranscriber | None = None
        self.groq_task = None
        self.last_q, self.last_ans, self.t_stop, self.stt_ms = "", None, None, None
        self.meeting_id: str | None = None
        self.speaker = "Interviewer"
        self.hands_free = True
        self.phase = Phase.IDLE
        self.gen_seq = 0
        self.answer_gen = 0
        self.last_dup_text, self.last_dup_ts = "", 0.0
        self.utterance = UtteranceBuffer(self._utterance_flush, self._utterance_waiting)
        self.active_qid = 0
        self.closed = False

    async def send(self, type_: str, **kw):
        if self.closed:
            return
        try:
            await self.ws.send_json({"type": type_, **kw})
        except Exception:
            pass

    async def set_phase(self, phase: Phase, legacy: str | None = None, reason: str | None = None):
        self.phase = phase
        status = ui_status(phase, legacy)
        await self.send("status", status=status)
        await self.send("phase", phase=phase.value, status=status, reason=reason or "")
        await self.send(
            "speaker_status",
            label=speaker_status_label(),
            hands_free=True,
            role=self.speaker,
        )

    def persist_line(self, text: str, ts_ms: int | None = None):
        if not self.meeting_id or not text.strip():
            return
        ts = ts_ms if ts_ms is not None else int(time.time() * 1000)
        try:
            db.add_line(self.meeting_id, self.speaker, text, ts)
        except Exception:
            pass

    async def _utterance_waiting(self):
        await self.set_phase(Phase.WAITING_FOR_COMPLETION)

    async def _utterance_flush(self, text: str, _seg: int):
        text = text.strip()
        if not text:
            await self.set_phase(Phase.LISTENING)
            return
        label, conf = local_classify(text)
        if label == "INCOMPLETE":
            await self.set_phase(Phase.LISTENING)
            return
        await self.process(text, label, conf)

    def on_final(self, text: str):
        now = time.monotonic()
        self.cuts = [(cut, ts) for cut, ts in self.cuts if now - ts < 12]
        original = text.strip()
        text = peel_cuts(original, [cut for cut, _ in self.cuts]).strip()
        if not text:
            return
        if text != original and len(words(text)) < 4:
            self._hold_fragment(text)
            return
        self.ctx.recent.append(text)
        self.utterance.ingest(text, asyncio.get_running_loop())

    def _hold_fragment(self, text: str):
        """Keep a short tail that was already partly staged until more speech arrives."""
        self.utterance.cancel_timer()
        self.utterance.buf = f"{self.utterance.buf} {text}".strip()
        self.utterance.hold = True
        loop = asyncio.get_running_loop()
        loop.create_task(self._utterance_waiting())
        self.utterance.timer = loop.create_task(self.utterance._fire(1.4))

    async def _emit_final(self, text: str, ts: int):
        self.partial = ""
        now = time.monotonic()
        if dedupe_final(text, self.last_dup_text, last_ts=self.last_dup_ts, now=now):
            return
        self.last_dup_text, self.last_dup_ts = text, now
        label, _conf = local_classify(text)
        route = route_turn(text, label, last_question=self.last_q, last_answer=self._last_answer_text())
        self.speaker = route.speaker
        await self.send("transcript_final", text=text, ts=ts, speaker=route.speaker)
        self.persist_line(text, ts)
        self.on_final(text)

    def _last_answer_text(self) -> str:
        if isinstance(self.last_ans, dict):
            return str(self.last_ans.get("answer") or "")
        return ""

    # ---- OpenAI realtime STT (true streaming transcription) --------------------
    async def run_stt(self):
        fails = 0
        while not self.closed and fails < 5:
            t0 = time.monotonic()
            try:
                async with connect(
                    STT_URL,
                    additional_headers={"Authorization": f"Bearer {config.API_KEY}"},
                    max_size=None,
                ) as up:
                    await up.send(
                        json.dumps(
                            {
                                "type": "session.update",
                                "session": {
                                    "type": "transcription",
                                    "audio": {
                                        "input": {
                                            "format": {"type": "audio/pcm", "rate": 24000},
                                            "transcription": {
                                                "model": self.stt_model or config.STT_MODEL or "gpt-4o-mini-transcribe",
                                                "language": "en",
                                            },
                                            "turn_detection": {
                                                "type": "server_vad",
                                                "threshold": 0.5,
                                                "silence_duration_ms": 500,
                                            },
                                        }
                                    },
                                },
                            }
                        )
                    )
                    self.up = up
                    await self.set_phase(Phase.LISTENING)
                    async for raw in up:
                        await self.on_stt(json.loads(raw))
            except asyncio.CancelledError:
                raise
            except Exception as ex:
                if "401" in str(ex):
                    await self.send("error", message=BAD_OPENAI)
                    return
                await self.send("error", message=f"Transcription connection lost ({ex}). Reconnecting...")
            finally:
                self.up = None
            fails = 0 if time.monotonic() - t0 > 30 else fails + 1
            await asyncio.sleep(min(2 * fails, 10) or 1)
        await self.send("error", message="Transcription is unavailable. Check your network and API key, then press Start again.")

    async def on_stt(self, e: dict):
        t = e.get("type", "")
        if t == "input_audio_buffer.speech_stopped":
            self.t_stop = time.monotonic()
        elif t.endswith("input_audio_transcription.delta"):
            self.partial = self.partial + e.get("delta", "")
            await self.send("transcript_partial", text=self.partial)
            await self.set_phase(Phase.LISTENING, legacy="TRANSCRIBING")
        elif t.endswith("input_audio_transcription.completed"):
            text = (e.get("transcript") or "").strip()
            self.partial = ""
            if not text:
                return
            self.stt_ms = int((time.monotonic() - self.t_stop) * 1000) if self.t_stop else None
            ts = int(time.time() * 1000)
            await self._emit_final(text, ts)
        elif t == "error":
            msg = (e.get("error") or {}).get("message", "Transcription error")
            await self.send("error", message=BAD_OPENAI if "api key" in msg.lower() else msg)

    async def _groq_final(self, text: str, ts: int):
        self.stt_ms = None
        await self._emit_final(text, ts)
        await self.set_phase(Phase.LISTENING)

    async def _groq_partial(self, text: str):
        self.partial = text
        await self.send("transcript_partial", text=text)
        await self.set_phase(Phase.LISTENING, legacy="TRANSCRIBING")

    async def run_groq_stt(self):
        model = self.stt_model or "whisper-large-v3-turbo"
        self.groq = GroqChunkTranscriber(model, self._groq_final, self._groq_partial)
        await self.groq.run_loop()

    async def audio(self, b: bytes):
        if self.closed:
            return
        if self.stt_mode == "groq" and self.groq:
            self.groq.feed(b, _pcm_voice(b))
            return
        if self.up:
            try:
                await self.up.send(
                    json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(b).decode()})
                )
            except Exception:
                pass

    async def _skip(self, text: str, reason: str, speaker: str, *, personal: bool = False):
        """Ignore this turn. An in-flight suggestion keeps playing."""
        self.speaker = speaker
        answering = self.gen and not self.gen.done()
        await self.send("transcript_skipped", reason=reason, text=text[:240], speaker=speaker)
        dec = evaluate_turn(
            text,
            speaker,
            True,
            "QUESTION" if personal else "IRRELEVANT",
            0.0,
            True,
            self.mode,
            personal=personal,
        )
        await self.send("decision", **dec.to_dict())
        if answering:
            await self.set_phase(Phase.ANSWERING)
            return
        await self.set_phase(Phase.SUPPRESSED, reason=dec.reason)
        await self.set_phase(Phase.LISTENING)

    async def process(self, text: str, label: str, conf: float):
        await self._consider(text, label, conf, force=False)

    async def stage(self):
        """Answer whatever has been heard so far, then keep listening for the rest."""
        text = clean(merge_gather(self.utterance.buf, self.partial))
        if not worth_staging(text):
            return
        now = time.monotonic()
        if self.last_stage_text and now - self.last_stage_at < 0.55 and similar(text, self.last_stage_text) > 0.82:
            return
        if any(similar(text, queued) > 0.9 for queued in self.queued_texts):
            return
        if self.jobs.qsize() >= 8:
            await self.send("error", message="Question queue is full. Wait for an answer to finish.")
            return
        self.utterance.reset()
        self.partial = ""
        await self.send("transcript_partial", text="")
        self.cuts.append((text, now))
        self.cuts = self.cuts[-4:]
        self.last_stage_text, self.last_stage_at = text, now
        await self._consider(text, *local_classify(text), force=True)

    def _ensure_worker(self):
        if self.worker and not self.worker.done():
            return
        self.worker = asyncio.get_running_loop().create_task(self._run_queue())

    def _forget(self, text: str):
        self.queued_texts = [queued for queued in self.queued_texts if queued != text]

    async def _run_queue(self):
        while not self.closed:
            item = await self.jobs.get()
            if item["epoch"] != self.epoch or self.closed:
                self._forget(item["text"])
                continue
            self.gen = asyncio.create_task(
                self.answer(item["text"], item["label"], item["t0"], item["qid"], item["epoch"])
            )
            try:
                await self.gen
            except asyncio.CancelledError:
                self._forget(item["text"])
                raise

    async def _enqueue(self, text: str, label: str, t0: float, confidence: float):
        if any(similar(text, queued) > 0.86 for queued in self.queued_texts):
            return
        if self.jobs.qsize() >= 8:
            await self.send("error", message="Question queue is full. Wait for an answer to finish.")
            return
        self.active_qid += 1
        qid = self.active_qid
        self.queued_texts.append(text)
        await self.send("question_detected", question=text, qtype=label, confidence=confidence, qid=qid)
        await self.jobs.put({"epoch": self.epoch, "text": text, "label": label, "t0": t0, "qid": qid})
        self._ensure_worker()

    async def _consider(self, text: str, label: str, conf: float, force: bool = False):
        route = route_turn(text, label, last_question=self.last_q, last_answer=self._last_answer_text())
        self.speaker = route.speaker
        forced_ok = force and route.kind not in ("personal", "candidate_answer") and route.reason not in (
            "acknowledgement",
            "small_talk",
            "personal_question",
            "candidate_speech",
            "candidate_reading_answer",
        )
        if route.certain and not route.should_answer and not forced_ok:
            await self._skip(text, route.reason, route.speaker, personal=route.kind == "personal")
            return
        t0 = time.monotonic()
        if force:
            if is_personal_question(text):
                await self._skip(text, "personal_question", "Interviewer", personal=True)
                return
            if label not in QUESTION_TYPES:
                label = "QUESTION"
            await self._enqueue(text, label, t0, max(conf, 0.99))
            return
        await self.set_phase(Phase.VALIDATING, reason="Evaluating utterance")
        try:
            if not route.certain:
                if len(text.split()) < 4:
                    await self._skip(text, "too_short", route.speaker)
                    return
                r = await classify(text, self.ctx)
                if r.get("personal") or is_personal_question(str(r.get("question") or text)):
                    await self._skip(text, "personal_question", "Interviewer", personal=True)
                    return
                if r.get("speaker") == "candidate":
                    await self._skip(text, "candidate_speech", "You")
                    return
                label, conf = r["type"], float(r.get("confidence") or 0)
                if r.get("is_question") and r.get("question"):
                    text = r["question"]
                elif not r.get("is_question"):
                    label = "STATEMENT"
                self.speaker = "Interviewer"
        except Exception as ex:
            await self.fail(ex)
            await self.set_phase(Phase.LISTENING)
            return

        if is_personal_question(text):
            await self._skip(text, "personal_question", "Interviewer", personal=True)
            return

        dec = evaluate_turn(text, self.speaker, True, label, conf, True, self.mode)
        await self.send("decision", **dec.to_dict())

        if not dec.should_answer:
            if dec.tier == "medium" and label in QUESTION_TYPES:
                await self.send("possible_question", question=text, confidence=dec.confidence)
            if self.gen and not self.gen.done():
                await self.set_phase(Phase.ANSWERING)
                return
            await self.set_phase(Phase.SUPPRESSED, reason=dec.reason)
            await self.set_phase(Phase.LISTENING)
            return

        if self.last_q and self.last_ans and similar(text, self.last_q) > 0.85:
            if any(similar(text, queued) > 0.85 for queued in self.queued_texts):
                return
            self.active_qid += 1
            qid = self.active_qid
            await self.send("question_detected", question=text, qtype=label, confidence=dec.confidence, qid=qid)
            await self._replay_cached(text, qid)
            return
        await self._enqueue(text, label, t0, dec.confidence)

    async def _replay_cached(self, q: str, qid: int = 0):
        await self.send("answer_start", question=q, qid=qid)
        await self.set_phase(Phase.ANSWERING)
        await self.send("answer_token", text=self.last_ans["answer"], qid=qid)
        await self.send("answer_complete", **self.last_ans, metrics={"cached": True}, qid=qid)
        await self.set_phase(Phase.COOLDOWN)
        await asyncio.sleep(config.ANSWER_COOLDOWN_SEC)
        if not self.closed:
            await self.set_phase(Phase.LISTENING)

    async def answer(self, q: str, qtype: str, t0: float, qid: int, epoch: int):
        t_det = time.monotonic()
        await self.send("answer_start", question=q, qid=qid)
        await self.set_phase(Phase.ANSWERING)
        first, done = None, None
        try:
            async for kind, val in stream_answer(self.ctx, q, qtype):
                if epoch != self.epoch or self.closed:
                    self._forget(q)
                    return
                if kind == "token":
                    first = first or time.monotonic()
                    await self.send("answer_token", text=val, qid=qid)
                else:
                    done = val
        except asyncio.CancelledError:
            self._forget(q)
            raise
        except Exception as ex:
            self._forget(q)
            await self.fail(ex)
            await self.set_phase(Phase.LISTENING)
            return
        if epoch != self.epoch or self.closed or not done:
            self._forget(q)
            return
        now = time.monotonic()
        m = {
            "stt_ms": self.stt_ms,
            "detection_ms": int((t_det - t0) * 1000),
            "first_token_ms": int((first - t_det) * 1000) if first else None,
            "total_ms": int((now - t_det) * 1000),
        }
        self.last_q, self.last_ans = q, done
        self._forget(q)
        self.ctx.add_turn(q, done["answer"])
        await self.send("answer_complete", **done, metrics=m, qid=qid)
        if self.jobs.empty() and epoch == self.epoch and not self.closed:
            await self.set_phase(Phase.COOLDOWN, reason="Suggestion ready")
            await asyncio.sleep(config.ANSWER_COOLDOWN_SEC)
            if epoch == self.epoch and not self.closed:
                await self.set_phase(Phase.LISTENING)

    async def fail(self, ex: Exception):
        local = self.ctx.provider == "ollama"
        groq = self.ctx.provider == "groq"
        if groq and isinstance(ex, openai.AuthenticationError):
            msg = BAD_GROQ
        elif isinstance(ex, openai.AuthenticationError):
            msg = BAD_OPENAI
        elif local and isinstance(ex, openai.NotFoundError):
            msg = f"Model '{config.OLLAMA_MODEL}' was not found on the local Ollama server."
        elif local and isinstance(ex, openai.APIConnectionError):
            msg = "The local model (Ollama) is not reachable or timed out."
        elif groq and isinstance(ex, openai.NotFoundError):
            msg = (
                f"Groq model '{self.ctx.answer_model}' is not on your account. "
                "Clear GROQ_ANSWER_MODEL in .env or use openai/gpt-oss-20b."
            )
        elif isinstance(ex, openai.APIConnectionError):
            msg = "The provider request timed out or could not connect."
        else:
            msg = f"{type(ex).__name__}: {ex}"
        await self.send("error", message=msg)

    async def control(self, m: dict):
        if "profile" in m:
            self.ctx.profile = m["profile"]
        if "mode" in m:
            self.mode = m["mode"]
        if m.get("meeting_id"):
            self.meeting_id = str(m["meeting_id"])
        stack = m.get("stack")
        t = m.get("type")
        if t == "start" or stack or m.get("llm") or m.get("stt"):
            r, err = await self._resolve_for_session(m.get("llm"), m.get("stt"), stack)
            if err:
                await self.send("error", message=err)
                return
            assert r is not None
            self.ctx.provider, self.stt_mode = r.llm, r.stt
            self.ctx.answer_model, self.stt_model = r.answer_model, r.stt_model
        if t == "start":
            r = self._resolved(self.ctx.provider, self.stt_mode, stack)
            if (r.llm == "openai" or r.stt == "openai") and not config.API_KEY:
                await self.send("error", message=NO_OPENAI)
                return
            if (r.llm == "groq" or r.stt == "groq") and not config.GROQ_API_KEY:
                await self.send("error", message=NO_GROQ)
                return
            self.closed = False
            self.gen_seq += 1
            self.answer_gen = self.gen_seq
            if self.stt_mode == "openai":
                if not self.stt or self.stt.done():
                    self.stt = asyncio.create_task(self.run_stt())
            elif self.stt_mode == "groq":
                if not self.groq_task or self.groq_task.done():
                    self.groq_task = asyncio.create_task(self.run_groq_stt())
                await self.set_phase(Phase.LISTENING)
            else:
                await self.set_phase(Phase.LISTENING)
            self._ensure_worker()
        elif t == "transcript" and self.stt_mode == "browser":
            text = (m.get("text") or "").strip()
            if not text:
                return
            if m.get("final"):
                self.partial = ""
                ts = int(time.time() * 1000)
                await self._emit_final(text, ts)
            else:
                self.partial = text
                await self.send("transcript_partial", text=text)
                await self.set_phase(Phase.LISTENING, legacy="TRANSCRIBING")
        elif t == "stage":
            await self.stage()
        elif t == "clear":
            self.reset()
        elif t == "stop":
            await self.close()
        elif t == "config":
            await self.set_phase(self.phase)

    def reset(self):
        self.epoch += 1
        self.gen_seq += 1
        self.answer_gen = self.gen_seq
        for task in (self.utterance.timer, self.gen):
            if task:
                task.cancel()
        while True:
            try:
                self.jobs.get_nowait()
            except asyncio.QueueEmpty:
                break
        self.utterance.reset()
        self.partial = ""
        self.cuts.clear()
        self.queued_texts.clear()
        self.last_stage_text, self.last_stage_at = "", 0.0
        self.last_q, self.last_ans = "", None
        self.last_dup_text, self.last_dup_ts = "", 0.0
        self.ctx.recent.clear()
        self.ctx.turns.clear()
        if self.groq:
            self.groq.last_emit = ""
            self.groq.pcm.clear()

    async def close(self):
        self.closed = True
        self.gen_seq += 1
        self.answer_gen = self.gen_seq
        self.reset()
        if self.worker:
            self.worker.cancel()
        if self.stt:
            self.stt.cancel()
        if self.groq_task:
            self.groq_task.cancel()
        if self.groq:
            self.groq.stop()
        self.phase = Phase.IDLE
