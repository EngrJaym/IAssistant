import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app import auth
from app import config
from app import db
from app import main


def test_auth_disabled_by_default(monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr(config, "GOOGLE_CLIENT_SECRET", "")
    monkeypatch.setattr(config, "GITHUB_CLIENT_ID", "")
    monkeypatch.setattr(config, "GITHUB_CLIENT_SECRET", "")
    monkeypatch.setattr(config, "SESSION_SECRET", "")
    c = TestClient(main.app)
    me = c.get("/api/auth/me").json()
    assert me["enabled"] is False
    assert me["user"] is None


def test_profile_requires_login_when_oauth_on(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://x")
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(config, "GOOGLE_CLIENT_SECRET", "sec")
    monkeypatch.setattr(config, "SESSION_SECRET", "test-secret-key-32chars-minimum!!")
    monkeypatch.setattr(db, "enabled", lambda: True)
    monkeypatch.setattr(auth, "oauth_enabled", lambda: True)
    monkeypatch.setattr(auth, "required", lambda: True)
    c = TestClient(main.app)
    assert c.put("/api/profile", json={"profile": {"resume": "x"}}).status_code == 401


def test_session_from_scope_roundtrip(monkeypatch):
    monkeypatch.setattr(config, "SESSION_SECRET", "test-secret-key-32chars-minimum!!")
    from starlette.middleware.sessions import SessionMiddleware
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def set_session(request):
        request.session["user_id"] = "abc-123"
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/set", set_session)])
    app.add_middleware(SessionMiddleware, secret_key=config.SESSION_SECRET, same_site="lax")
    c = TestClient(app)
    c.get("/set")
    cookie = c.cookies.get("session")
    assert cookie
    scope = {"headers": [(b"cookie", f"session={cookie}".encode("latin-1"))]}
    data = auth.session_from_scope(scope)
    assert data.get("user_id") == "abc-123"
