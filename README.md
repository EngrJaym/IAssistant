# IAssistant

Hands-free interview assistant: listens for the **interviewer's** speech, waits until each utterance is complete, validates **real interview questions**, and streams a short, truthful, speakable answer. Greetings, small talk, acknowledgements, statements, and half-finished sentences are ignored by default.

Use for practice or where AI assistance is explicitly permitted.

## Provider stacks (UI: **Providers** or **Custom**)

| Stack | Speech-to-text | Answers |
|---|---|---|
| **OpenAI** | OpenAI realtime transcription (true streaming) | OpenAI chat (`ANSWER_MODEL`) |
| **Groq** | Groq Whisper via **chunked** near-real-time STT (not live streaming) | Groq chat (`GROQ_ANSWER_MODEL`, e.g. `openai/gpt-oss-20b`) |
| **Free** | Browser speech recognition (Chrome/Edge) | Local **Ollama** (`OLLAMA_MODEL`) |
| **Custom** | Any of the above, independently | Any of the above, independently |

Keys stay on the backend (`OPENAI_API_KEY`, `GROQ_API_KEY`). Empty model env vars use auto-selected models per stack. Defaults: `STT_PROVIDER` / `LLM_PROVIDER` in `.env`; session UI overrides and is remembered.

**Free caveats:** browser STT uses your browser vendor's speech service; Ollama is slower on CPU. **Groq caveats:** STT is sent in overlapping audio chunks (configurable); you pay per Groq API usage.

## Hands-free mode

When **Hands-free** is on (default via `HANDS_FREE=true`):

- Only speech tagged as **Interviewer** runs the question pipeline (not **You**).
- Session phases: listening → waiting for completion → validating → answering → cooldown → listening.
- Utterances are merged across pauses and chunk boundaries; rephrases replace stale pending text.
- Answers generate automatically after validation—no per-question click.

**Speaker identification is not ML diarization.** You choose the active speaker (Interviewer / You) or rely on who is speaking into the selected audio source. If the speaker is unknown or set to You, the app does not answer (conservative). For calls, prefer **Tab / meeting audio** (browser display capture with audio) or route meeting audio into the mic; document your OS limitations.

## Quick start with Docker (recommended)

```bash
cp .env.example .env                         # set keys as needed
docker compose up --build                    # http://localhost
docker compose --profile free up --build     # + Ollama in Docker
docker compose down
```

- Services: `backend`, `frontend` (nginx proxy for `/api`, `/ws`). Meeting notes and OAuth accounts live in **server memory** (cleared on backend restart).
- Host Ollama when Docker pull fails: `OLLAMA_BASE_URL=http://host.docker.internal:11434/v1`, comment out `COMPOSE_PROFILES=free`.

Microphone works on `http://localhost`; remote access needs HTTPS.

## Without Docker

**Windows:** `start.bat`. **Manual:** backend `uvicorn app.main:app --port 8000`, frontend `npm run dev` → http://localhost:5173.

## Configuration (`.env`)

```env
OPENAI_API_KEY=
GROQ_API_KEY=

HANDS_FREE=true
QUESTION_CONFIDENCE_THRESHOLD=0.80
MAX_ANSWER_WORDS=100
MIN_ANSWER_WORDS=40
ANSWER_COOLDOWN_SEC=0.35

# Groq chunked STT (near-real-time, not streaming)
GROQ_CHUNK_SECONDS=4
GROQ_CHUNK_OVERLAP_MS=450
GROQ_CHUNK_SILENCE_MS=750

GROQ_STT_MODEL=
GROQ_ANSWER_MODEL=
TRANSCRIPTION_MODEL=
ANSWER_MODEL=

```

Restart the backend after edits. Modes: *Normal* / *Balanced* / *Aggressive* confidence gates (see UI).

## Using it

1. **Setup:** assistant instructions, job description, resume (browser localStorage; synced to server memory when signed in).
2. **Providers:** stack or Custom STT + LLM; enable **Hands-free** for automatic Q&A.
3. **Audio:** microphone or **display/tab audio** (Chrome: share tab/window with audio checked).
4. Set **Active speaker** to Interviewer when you are not the one in the captured stream.
5. **START** → allow capture. **MUTE**, **CLEAR**, **STOP** cancel in-flight work. **Dev metrics** for latency.

## Architecture

```
audio (mic | display) -> VAD gate -> WebSocket
  -> STT: OpenAI realtime | Groq chunked Whisper | browser SpeechRecognition
  -> merge/dedupe overlaps -> UtteranceBuffer (completion timer, rephrase)
  -> speaker gate (hands-free) -> local rules -> LLM classify if ambiguous
  -> validated question -> stream answer (OpenAI | Groq | Ollama), gen-id cancellation
  -> UI (phase + speaker status)
```

Key modules: `session_ws.py` (session + phases), `session_flow.py`, `speaker_gate.py`, `stt_groq_chunked.py`, `transcript_merge.py`, `detector.py`, `agent.py`, `providers.py`, `main.py` (HTTP + WS).

## Tests

```bash
cd backend && python -m pytest -q
```

Covers question detection, chunk merge, hands-free gating, duplicates, cancellation, WebSocket, provider resolution, and mocked paid APIs.

## Accounts

The app opens on a login page until someone is signed in. There is no sign-up. Google can prove an identity, and `ALLOWED_EMAILS` decides whether that person may use IAssistant. An empty list allows nobody. Email and password accounts are also provisioned in `AUTH_PASSWORDS` (`email:password`, separated by semicolons or new lines) and must appear on the allowlist. Meetings and assistant setup are stored per user in **server memory** (until restart).

1. Add `ALLOWED_EMAILS=you@gmail.com` and, for password sign-in, `AUTH_PASSWORDS=you@gmail.com:a-long-password`.
2. For Google, create OAuth credentials and set the redirect URI to `{APP_BASE_URL}/api/auth/callback/google`.
3. Add `SESSION_SECRET` (random 32+ bytes), `APP_BASE_URL`, and the Google client id and secret.
4. Restart the backend. A saved session stays until **Log out**. A verified Google account that is not on the list is not signed in.

Set `AUTH_REQUIRED=false` only if you need the older anonymous mode for local API tests.

## Privacy

Profile and meeting data live in process memory on the backend (not written to disk). Session cookies are httpOnly. Third-party STT/LLM providers still receive audio/text you send them when those stacks are used.

Optional later: set `DATABASE_URL` to enable PostgreSQL persistence (advanced).

## Troubleshooting

### Docker pull fails (`CloudFront` / `EOF` on `ollama`)

Retry after restarting Docker Desktop, changing DNS, or using another network/VPN. Or install Ollama on the host and set `OLLAMA_BASE_URL=http://host.docker.internal:11434/v1` without the `free` compose profile.

- **No answers in hands-free:** set Active speaker to Interviewer; check phase in UI; raise confidence or switch mode.
- **Groq STT errors:** verify `GROQ_API_KEY` and model names; reduce chunk rate if rate-limited.
- **Display audio silent:** pick the correct tab/window and enable "Share audio".
- **Ollama unreachable:** start Ollama or use Docker `free` profile; wait for model pull.
