import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from app import main
from app import session_ws
from app.agent import partial_answer
from app.detector import QUESTION_TYPES, clean, local_classify, similar


def label(t): return local_classify(t)[0]


@pytest.mark.parametrize("t", ["What is Docker?", "Can you tell me about your experience with Python?",
                               "Tell me about your experience with Python.", "Walk me through how you designed this.",
                               "Your application processes millions of records. How would you scale that?",
                               "Actually, let me rephrase that. How would you deploy this?",
                               "Okay, can you explain how you implemented the upload pipeline?"])
def test_questions(t): assert label(t) in QUESTION_TYPES


@pytest.mark.parametrize("t", ["That's interesting.", "Okay, let's continue.", "Right.", "Excellent.",
                               "Great, thanks for joining.", "Okay, let's move on.", "Hi, how are you today?"])
def test_ignored(t): assert label(t) not in QUESTION_TYPES | {"AMBIGUOUS"}


def test_incomplete():
    assert label("How would you...") == "INCOMPLETE"
    assert label("Let's say we have ten million users...") == "INCOMPLETE"
    assert label("Can you explain how you") == "INCOMPLETE"


def test_follow_up(): assert label("What about performance?") == "FOLLOW_UP_QUESTION"
def test_statement_is_ambiguous_not_question(): assert label("So I see you've been working with Python.") == "AMBIGUOUS"
def test_rephrase(): assert clean("How did you deploy it? Actually, let me ask that differently...") == ""
def test_similarity(): assert similar("What is Redis?", "what is redis") > 0.85 and similar("What is Redis?", "Explain Kafka partitions") < 0.6


def test_partial_answer_stream():
    assert partial_answer('{"answer": "Hel') == "Hel"
    assert partial_answer('{"answer": "a \\"q\\" b\\nc", "key_points": []}') == 'a "q" b\nc'
    assert partial_answer('{"answer": "x\\') == "x"


class FakeWS:
    def __init__(self): self.ev = []
    async def send_json(self, d): self.ev.append(d)


async def fake_stream(ctx, q, qt):
    yield "token", "Docker is "; yield "token", "a container runtime."
    yield "done", {"answer": "Docker is a container runtime.", "key_points": ["a"], "follow_up": "f", "confidence": "high"}


def run_pipeline(texts, monkeypatch, wait=0.6):
    async def go():
        ws = FakeWS(); s = main.Session(ws, main._resolve_for_session, main._resolved)
        async def boom(*a, **k): raise AssertionError("LLM classify must not run")
        monkeypatch.setattr(session_ws, "stream_answer", fake_stream); monkeypatch.setattr(session_ws, "classify", boom)
        for t in texts: s.on_final(t); await asyncio.sleep(0.02)
        await asyncio.sleep(wait); await s.close()
        return [e["type"] for e in ws.ev], ws.ev
    return asyncio.run(go())


def test_pipeline_answers_question_only_once(monkeypatch):
    types, ev = run_pipeline(["What is Docker?"], monkeypatch)
    assert types.count("answer_start") == 1 and "".join(e["text"] for e in ev if e["type"] == "answer_token") == "Docker is a container runtime."
    assert "answer_complete" in types and any(
        e.get("status") in ("ANSWER READY", "SUGGESTION READY") for e in ev if e["type"] == "status"
    )
    assert [e for e in ev if e["type"] == "answer_complete"][0]["metrics"]["total_ms"] >= 0


def test_pipeline_answers_each_interviewer_question(monkeypatch):
    types, ev = run_pipeline(
        ["What is Docker?", "How would you scale that service?"],
        monkeypatch,
        wait=1.2,
    )
    questions = [e["question"] for e in ev if e["type"] == "question_detected"]
    assert types.count("answer_start") == 2
    assert questions[0].startswith("What is Docker")
    assert "scale" in questions[1].lower()


def test_pipeline_ignores_answer_and_personal_question(monkeypatch):
    types, ev = run_pipeline(
        [
            "What is Docker?",
            "I would package the application in an image and run it on Kubernetes.",
            "How old are you?",
            "Are you married?",
        ],
        monkeypatch,
        wait=1.2,
    )
    assert types.count("answer_start") == 1
    assert [e["question"] for e in ev if e["type"] == "question_detected"] == ["What is Docker?"]


def test_pipeline_ignores_filler(monkeypatch):
    types, _ = run_pipeline(["Hi, how are you today?", "That's interesting.", "Okay, let's continue."], monkeypatch)
    assert "answer_start" not in types and "question_detected" not in types


def test_pipeline_merges_interrupted_question(monkeypatch):
    types, ev = run_pipeline(["How would you design...", "a scalable upload system?"], monkeypatch, wait=4)
    assert types.count("answer_start") == 1 and [e for e in ev if e["type"] == "question_detected"][0]["question"].startswith("How would you design")


def test_pipeline_merges_unpunctuated_fragment(monkeypatch):
    types, ev = run_pipeline(["Can you explain how you handled", "large file uploads in your application?"], monkeypatch, wait=1)
    assert types.count("answer_start") == 1 and "large file uploads" in [e for e in ev if e["type"] == "question_detected"][0]["question"]


def test_pipeline_self_correction_answers_only_final(monkeypatch):
    types, ev = run_pipeline(["How did you deploy the application?", "Actually, let me ask that differently...", "How would you deploy it to production?"], monkeypatch)
    qs = [e["question"] for e in ev if e["type"] == "question_detected"]
    assert qs == ["How would you deploy it to production?"]


def test_pipeline_duplicate_reuses_answer(monkeypatch):
    async def go():
        ws = FakeWS(); s = main.Session(ws, main._resolve_for_session, main._resolved); calls = []
        async def counting(ctx, q, qt):
            calls.append(q)
            async for x in fake_stream(ctx, q, qt): yield x
        monkeypatch.setattr(session_ws, "stream_answer", counting)
        s.on_final("What is Docker?"); await asyncio.sleep(0.6)
        s.on_final("What is Docker?"); await asyncio.sleep(0.6); await s.close()
        return calls, ws.ev
    calls, ev = asyncio.run(go())
    assert len(calls) == 1 and [e for e in ev if e["type"] == "answer_complete"][-1]["metrics"] == {"cached": True}


def test_new_question_cancels_old_generation(monkeypatch):
    async def go():
        ws = FakeWS(); s = main.Session(ws, main._resolve_for_session, main._resolved); finished = []
        async def slow(ctx, q, qt):
            yield "token", "x"
            await asyncio.sleep(1 if "Redis" in q else 0)
            finished.append(q)
            yield "done", {"answer": "x", "key_points": [], "follow_up": "", "confidence": "high"}
        monkeypatch.setattr(session_ws, "stream_answer", slow)
        s.on_final("What is Redis?"); await asyncio.sleep(0.4)
        s.on_final("Explain Kafka partitions to me please?"); await asyncio.sleep(0.5); await s.close()
        return finished
    assert asyncio.run(go()) == ["Explain Kafka partitions to me please?"]


def test_health_and_ws_without_key(monkeypatch):
    from fastapi.testclient import TestClient
    for k, v in {"API_KEY": "", "GROQ_API_KEY": "", "LLM_PROVIDER": "openai", "STT_PROVIDER": "openai", "PROVIDER_STACK": "openai"}.items():
        monkeypatch.setattr(main.config, k, v)
    c = TestClient(main.app)
    h = c.get("/api/health").json()
    assert h["ok"] is True and h["defaults"]["llm"] == "openai" and h["stacks"]["groq"]["answer_model"]
    assert c.post("/api/session/start", json={"stack": "openai"}).status_code == 400
    with c.websocket_connect("/ws/interview") as ws:
        ws.send_json({"type": "start", "stack": "openai"})
        assert ws.receive_json() == {"type": "error", "message": "OPENAI_API_KEY is not configured."}
        ws.send_bytes(b"\x00\x00")  # audio with no upstream is ignored without crashing


def test_session_start_provider_checks(monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setattr(main.config, "API_KEY", "")
    monkeypatch.setattr(main.config, "GROQ_API_KEY", "")
    c = TestClient(main.app); post = lambda **b: c.post("/api/session/start", json=b)
    assert post(stack="openai").json()["error"] == "OPENAI_API_KEY is not configured."
    assert post(stack="groq").json()["error"] == "GROQ_API_KEY is not configured."
    assert post(llm="ollama", stt="openai").status_code == 400            # paid STT still needs a key
    async def down(): raise ConnectionError()
    async def empty(): return []
    async def ready(): return [main.config.OLLAMA_MODEL + ":latest"]
    monkeypatch.setattr(main, "ollama_models", down); r = post(llm="ollama", stt="browser")
    assert r.status_code == 400 and "not reachable" in r.json()["error"] and "docker compose --profile free" in r.json()["hint"]
    monkeypatch.setattr(main, "ollama_models", empty); assert "not downloaded" in post(llm="ollama", stt="browser").json()["error"]
    monkeypatch.setattr(main, "ollama_models", ready)
    assert post(llm="ollama", stt="browser").json()["ok"] is True  # fully free, no key


def test_user_setup_reaches_system_prompt():
    from app.agent import Context, system_prompt
    c = Context(); c.profile = {"instructions": "Answer as a senior backend engineer. Max 80 words.", "job_description": "Backend role using FastAPI",
                                "resume": "5 years Python, FastAPI, Docker", "target": "Acme Corp - Backend Engineer"}
    sp = system_prompt(c)
    for needle in ["senior backend engineer", "FastAPI", "5 years Python", "Applying for: Acme Corp", "never override the rule against inventing"]:
        assert needle in sp
    assert "USER INSTRUCTIONS" not in system_prompt(Context())


# ---- free provider path, end to end through the real OpenAI SDK against an Ollama-style (OpenAI-compatible) server
import json, socket, threading, time
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from app import agent, config

ANSWER = {"answer": "Docker packages apps into containers. I use it for repeatable deployments.", "key_points": ["containers", "repeatable"],
          "follow_up": "How do you orchestrate them?", "confidence": "high"}


@pytest.fixture(scope="module")
def fake_ollama():
    api, seen = FastAPI(), []

    @api.post("/v1/chat/completions")
    async def chat(req: Request):
        body = await req.json(); seen.append(body)
        if body.get("stream"):
            txt = json.dumps(ANSWER); parts = [txt[i:i + 7] for i in range(0, len(txt), 7)]
            def gen():
                for p in parts:
                    yield "data: " + json.dumps({"id": "x", "object": "chat.completion.chunk", "created": 0, "model": "m", "choices": [{"index": 0, "delta": {"content": p}, "finish_reason": None}]}) + "\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")
        verdict = {"is_question": False, "type": "STATEMENT", "confidence": 0.9, "question": "", "reason": "statement"}
        return JSONResponse({"id": "x", "object": "chat.completion", "created": 0, "model": "m", "choices": [{"index": 0, "message": {"role": "assistant", "content": json.dumps(verdict)}, "finish_reason": "stop"}]})

    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
    server = uvicorn.Server(uvicorn.Config(api, host="127.0.0.1", port=port, log_level="error"))
    t = threading.Thread(target=server.run, daemon=True); t.start()
    while not server.started: time.sleep(0.05)
    yield f"http://127.0.0.1:{port}/v1", seen
    server.should_exit = True; t.join(5)


def test_free_stack_end_to_end(fake_ollama, monkeypatch):
    url, seen = fake_ollama
    monkeypatch.setattr(config, "API_KEY", "")                         # no OpenAI key at all
    monkeypatch.setattr(config, "OLLAMA_BASE_URL", url); monkeypatch.setattr(config, "OLLAMA_MODEL", "tiny-model")
    monkeypatch.setattr(agent, "_clients", {})
    async def go():
        ws = FakeWS(); s = main.Session(ws, main._resolve_for_session, main._resolved)
        await s.control({"type": "start", "llm": "ollama", "stt": "browser", "profile": {"instructions": "Be brief", "resume": "Docker user"}})
        await s.control({"type": "transcript", "text": "what is dock", "final": False})
        await s.control({"type": "transcript", "text": "What is Docker?", "final": True})
        await asyncio.sleep(1.5)
        await s.control({"type": "transcript", "text": "So I see you've been working with containers.", "final": True})   # ambiguous -> classified by the local model
        await asyncio.sleep(1.5); await s.close()
        return ws.ev
    ev = asyncio.run(go()); types = [e["type"] for e in ev]
    assert "error" not in types and types.count("answer_start") == 1 and types[0] == "status" and "transcript_partial" in types
    assert "".join(e["text"] for e in ev if e["type"] == "answer_token") == ANSWER["answer"]
    done = [e for e in ev if e["type"] == "answer_complete"][0]
    assert done["key_points"] == ANSWER["key_points"] and done["confidence"] == "high"
    assert {b["model"] for b in seen} == {"tiny-model"} and len(seen) == 2          # 1 answer + 1 classify (statement ignored)
    sysmsg = [b for b in seen if b.get("stream")][0]["messages"][0]["content"]
    assert "Be brief" in sysmsg and "Docker user" in sysmsg
