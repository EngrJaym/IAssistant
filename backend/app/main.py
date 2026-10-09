"""FastAPI app: REST helpers + /ws/interview (mic audio in -> transcripts, detection and streamed answers out)."""
import io
import json
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from . import auth
from . import config
from . import db
from . import oauth_providers
from .providers import catalog, resolve
from .session_ws import Session

NO_OPENAI = "OPENAI_API_KEY is not configured."
NO_GROQ = "GROQ_API_KEY is not configured."


def _resolved(
    llm: str | None = None,
    stt: str | None = None,
    stack: str | None = None,
    groq_available: set[str] | None = None,
):
    return resolve(
        llm=llm or config.LLM_PROVIDER,
        stt=stt or config.STT_PROVIDER,
        stack=stack or config.PROVIDER_STACK or None,
        openai_answer=config.ANSWER_MODEL,
        openai_stt=config.STT_MODEL,
        groq_answer=config.GROQ_ANSWER_MODEL,
        groq_stt=config.GROQ_STT_MODEL,
        ollama_model=config.OLLAMA_MODEL,
        groq_available=groq_available,
    )


async def groq_model_ids() -> set[str]:
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(
            f"{config.GROQ_BASE_URL}/models",
            headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
        )
        r.raise_for_status()
        return {m["id"] for m in r.json().get("data", []) if m.get("id")}


async def _resolve_for_session(llm: str | None, stt: str | None, stack: str | None):
    groq_avail = None
    probe = _resolved(llm, stt, stack)
    if _needs_groq(probe) and config.GROQ_API_KEY:
        groq_avail = await groq_model_ids()
    try:
        return _resolved(llm, stt, stack, groq_available=groq_avail), None
    except ValueError as ex:
        return None, str(ex)


def _needs_openai(r) -> bool:
    return r.llm == "openai" or r.stt == "openai"


def _needs_groq(r) -> bool:
    return r.llm == "groq" or r.stt == "groq"

@asynccontextmanager
async def lifespan(_app: FastAPI):
    if db.enabled():
        try:
            db.init_db()
        except Exception as ex:
            print(f"Database init failed: {ex}")
    yield


app = FastAPI(title="IAssistant", lifespan=lifespan)
_origins = ["http://localhost", "http://127.0.0.1", "http://localhost:80", "http://127.0.0.1:80", "http://localhost:5173", "http://127.0.0.1:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Always on so request.session works; production OAuth still requires SESSION_SECRET in auth.oauth_enabled().
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SESSION_SECRET or "dev-session-not-for-production",
    same_site="lax",
    https_only=False,
)


@app.get("/api/health")
def health():
    default = _resolved()
    if config.PROVIDER_STACK:
        default = _resolved(stack=config.PROVIDER_STACK)
    return {
        "ok": True,
        "database": db.ping(),
        "storage": {"ok": db.ping(), "backend": db.backend()},
        "configured": {"openai": bool(config.API_KEY), "groq": bool(config.GROQ_API_KEY), "ollama": True},
        "defaults": {"stack": default.stack, "llm": default.llm, "stt": default.stt},
        "models": {
            "answer": default.answer_model,
            "stt": default.stt_model,
            "local": config.OLLAMA_MODEL,
        },
        "hands_free": config.HANDS_FREE,
        "audio": {
            "note": "Browser can capture tab/meeting audio via displayMedia (Chrome/Edge). True ML diarization is not included.",
            "groq_stt_mode": "chunked_near_realtime",
            "groq_chunk_seconds": config.GROQ_CHUNK_SECONDS,
        },
        "stacks": catalog(
            openai_answer=config.ANSWER_MODEL,
            openai_stt=config.STT_MODEL,
            groq_answer=config.GROQ_ANSWER_MODEL,
            groq_stt=config.GROQ_STT_MODEL,
            ollama_model=config.OLLAMA_MODEL,
        ),
        "auth": {
            "enabled": auth.oauth_enabled(),
            "required": auth.required(),
            "providers": auth.providers(),
            "login_base": "/api/auth/login",
        },
    }


@app.get("/api/auth/me")
def auth_me(request: Request):
    user = auth.user_from_request(request)
    profile = db.get_profile(user.id) if user else {}
    return {
        "enabled": auth.oauth_enabled(),
        "required": auth.required(),
        "providers": auth.providers(),
        "user": auth.public_user(user) if user else None,
        "profile": profile,
    }


@app.get("/api/auth/login/{provider}")
def auth_login(provider: str, request: Request):
    if provider not in auth.providers():
        return JSONResponse({"error": "OAuth provider not configured."}, status_code=404)
    state = auth.new_oauth_state()
    request.session["oauth_state"] = state
    return RedirectResponse(oauth_providers.authorize_url(provider, state))


@app.get("/api/auth/callback/{provider}")
async def auth_callback(provider: str, request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return RedirectResponse(f"{config.APP_BASE_URL}/?auth_error={error}")
    if provider not in auth.providers():
        return JSONResponse({"error": "OAuth provider not configured."}, status_code=404)
    expected = request.session.pop("oauth_state", None)
    if not code or not state or state != expected:
        return RedirectResponse(f"{config.APP_BASE_URL}/?auth_error=invalid_state")
    try:
        info = await oauth_providers.exchange_code(provider, code)
        uid = auth.upsert_oauth_user(info["provider"], info["sub"], info["email"], info.get("name"), info.get("picture"))
        auth.login_user(request, uid)
    except Exception as ex:
        return RedirectResponse(f"{config.APP_BASE_URL}/?auth_error=oauth_failed")
    return RedirectResponse(f"{config.APP_BASE_URL}/")


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    auth.logout_user(request)
    return {"ok": True}


class ProfileReq(BaseModel):
    profile: dict[str, str] = {}


@app.get("/api/profile")
def profile_get(request: Request):
    user = auth.require_user(request)
    return {"profile": db.get_profile(user.id)}


@app.put("/api/profile")
def profile_put(request: Request, req: ProfileReq):
    user = auth.require_user(request)
    db.save_profile(user.id, req.profile)
    return {"ok": True, "profile": db.get_profile(user.id)}


async def ollama_models() -> list[str]:
    async with httpx.AsyncClient(timeout=3) as c:
        r = await c.get(config.OLLAMA_BASE_URL.rsplit("/v1", 1)[0] + "/api/tags")
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]


class StartReq(BaseModel):
    stack: str | None = None   # free | groq | openai
    llm: str | None = None
    stt: str | None = None


@app.post("/api/session/start")
async def session_start(request: Request, req: StartReq = StartReq()):
    user = auth.user_from_request(request)
    if auth.required() and not user:
        return JSONResponse(
            {"error": "Sign in required.", "hint": "Use Sign in to save meetings and sync your setup to your account."},
            status_code=401,
        )
    r, err = await _resolve_for_session(req.llm, req.stt, req.stack or config.PROVIDER_STACK or None)
    if err:
        return JSONResponse({"error": err, "hint": "Use a free-tier Groq model (e.g. openai/gpt-oss-20b) or clear GROQ_ANSWER_MODEL in .env."}, status_code=400)
    assert r is not None
    if _needs_openai(r) and not config.API_KEY:
        return JSONResponse({"error": NO_OPENAI, "hint": "Set OPENAI_API_KEY in .env, or choose the Free or Groq stack."}, status_code=400)
    if _needs_groq(r) and not config.GROQ_API_KEY:
        return JSONResponse({"error": NO_GROQ, "hint": "Set GROQ_API_KEY in .env (https://console.groq.com), or choose another stack."}, status_code=400)
    llm, stt = r.llm, r.stt
    if llm == "ollama":
        try: names = await ollama_models()
        except Exception:
            return JSONResponse({"error": f"The local model server (Ollama) is not reachable at {config.OLLAMA_BASE_URL}.",
                                 "hint": "Start it with: docker compose --profile free up"}, status_code=400)
        want = config.OLLAMA_MODEL
        if want not in names and f"{want}:latest" not in names:
            return JSONResponse({"error": f"Local model '{want}' is not downloaded yet.",
                                 "hint": f"It downloads automatically with 'docker compose --profile free up' (first time can take a few minutes), or run: ollama pull {want}"}, status_code=400)
    meeting_id = db.create_meeting(r.stack, llm, stt, user_id=user.id if user else None)
    return {
        "ok": True,
        "meeting_id": meeting_id,
        "stack": r.stack,
        "llm": llm,
        "stt": stt,
        "models": {"answer": r.answer_model, "stt": r.stt_model},
    }


class StopReq(BaseModel):
    meeting_id: str | None = None


@app.post("/api/session/stop")
def session_stop(request: Request, req: StopReq = StopReq()):
    user = auth.user_from_request(request)
    if req.meeting_id:
        auth.assert_meeting_access(req.meeting_id, user)
        db.end_meeting(req.meeting_id)
    return {"ok": True}


@app.get("/api/meetings")
def meetings_list(request: Request):
    user = auth.user_from_request(request)
    if auth.required() and not user:
        return JSONResponse({"error": "Sign in required."}, status_code=401)
    uid = user.id if user else None
    return {"meetings": db.list_meetings(user_id=uid)}


@app.get("/api/meetings/{meeting_id}")
def meetings_get(meeting_id: str, request: Request):
    user = auth.user_from_request(request)
    if auth.required() and not user:
        return JSONResponse({"error": "Sign in required."}, status_code=401)
    uid = user.id if user else None
    data = db.get_meeting(meeting_id, user_id=uid if auth.required() else None)
    if not data:
        return JSONResponse({"error": "Meeting not found."}, status_code=404)
    return data


@app.delete("/api/meetings/{meeting_id}")
def meetings_delete(meeting_id: str, request: Request):
    user = auth.user_from_request(request)
    if auth.required() and not user:
        return JSONResponse({"error": "Sign in required."}, status_code=401)
    uid = user.id if user else None
    if not db.delete_meeting(meeting_id, user_id=uid if auth.required() else None):
        return JSONResponse({"error": "Meeting not found."}, status_code=404)
    return {"ok": True}


@app.get("/api/meetings/{meeting_id}/export.docx")
def meetings_export_docx(meeting_id: str, request: Request):
    user = auth.user_from_request(request)
    if auth.required() and not user:
        return JSONResponse({"error": "Sign in required."}, status_code=401)
    uid = user.id if user else None
    raw = db.export_docx_bytes(meeting_id, user_id=uid if auth.required() else None)
    if not raw:
        return JSONResponse({"error": "Meeting not found."}, status_code=404)
    data = db.get_meeting(meeting_id, user_id=uid if auth.required() else None) or {}
    title = (data.get("title") or "meeting").replace(" ", "-")[:40]
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{title}-dialogue.docx"'},
    )


@app.post("/api/parse-resume")
async def parse_resume(file: UploadFile):
    data, name = await file.read(), (file.filename or "").lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        text = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
    elif name.endswith(".docx"):
        import docx
        text = "\n".join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)
    else:
        text = data.decode("utf-8", "ignore")
    return {"text": text[:20000]}


@app.websocket("/ws/interview")
async def interview(ws: WebSocket):
    await ws.accept()
    if auth.required() and not auth.user_from_ws(ws):
        await ws.send_json({"type": "error", "message": "Sign in required to start an interview session."})
        await ws.close()
        return
    s = Session(ws, _resolve_for_session, _resolved)
    try:
        while True:
            m = await ws.receive()
            if m["type"] == "websocket.disconnect": break
            if m.get("bytes"): await s.audio(m["bytes"])
            elif m.get("text"): await s.control(json.loads(m["text"]))
    finally:
        await s.close()
