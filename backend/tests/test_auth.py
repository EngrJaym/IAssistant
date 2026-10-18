import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi.testclient import TestClient
from app import auth
from app import config
from app import db
from app import main


def test_auth_disabled_by_default(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", False)
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr(config, "GOOGLE_CLIENT_SECRET", "")
    monkeypatch.setattr(config, "GITHUB_CLIENT_ID", "")
    monkeypatch.setattr(config, "GITHUB_CLIENT_SECRET", "")
    monkeypatch.setattr(config, "SESSION_SECRET", "")
    c = TestClient(main.app)
    me = c.get("/api/auth/me").json()
    assert me["enabled"] is False
    assert me["required"] is False
    assert me["user"] is None


def test_login_required_blocks_anonymous_sessions(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    c = TestClient(main.app)
    me = c.get("/api/auth/me").json()
    assert me["required"] is True
    assert me["user"] is None
    assert c.post("/api/session/start", json={}).status_code == 401
    assert c.post("/api/auth/register", json={"email": "a@b.com", "password": "x"}).status_code == 404


def test_password_login_uses_provisioned_accounts_only(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    monkeypatch.setattr(config, "SESSION_SECRET", "test-secret-key-32chars-minimum!!")
    monkeypatch.setattr(config, "ALLOWED_EMAILS", "coach@example.com")
    monkeypatch.setattr(config, "AUTH_PASSWORDS", "coach@example.com:correct-horse;other@example.com:nope")
    c = TestClient(main.app)

    wrong = c.post("/api/auth/login/password", json={"email": "coach@example.com", "password": "wrong"})
    assert wrong.status_code == 401
    assert wrong.json()["error"] == "Invalid email or password."

    stranger = c.post("/api/auth/login/password", json={"email": "new@example.com", "password": "correct-horse"})
    assert stranger.status_code == 401

    not_listed = c.post("/api/auth/login/password", json={"email": "other@example.com", "password": "nope"})
    assert not_listed.status_code == 401

    ok = c.post("/api/auth/login/password", json={"email": "Coach@Example.com", "password": "correct-horse"})
    assert ok.status_code == 200
    me = c.get("/api/auth/me").json()
    assert me["user"]["email"] == "coach@example.com"
    assert me["user"]["provider"] == "password"

    monkeypatch.setattr(config, "ALLOWED_EMAILS", "")
    closed = c.post("/api/auth/login/password", json={"email": "coach@example.com", "password": "correct-horse"})
    assert closed.status_code == 401
    assert "ALLOWED_EMAILS" in closed.json()["error"]


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


def test_allowlist_rules(monkeypatch):
    monkeypatch.setattr(config, "ALLOWED_EMAILS", "Coach@Example.com, other@example.com")
    assert auth.email_allowed(" coach@example.com ")
    auth.check_allowed("other@example.com", provider="google", email_verified=True)
    with pytest.raises(auth.AllowlistError) as denied:
        auth.check_allowed("nope@example.com", provider="google", email_verified=True)
    assert denied.value.code == "not_allowed"
    with pytest.raises(auth.AllowlistError) as unverified:
        auth.check_allowed("coach@example.com", provider="google", email_verified=False)
    assert unverified.value.code == "unverified_email"
    monkeypatch.setattr(config, "ALLOWED_EMAILS", "")
    with pytest.raises(auth.AllowlistError) as empty:
        auth.check_allowed("coach@example.com", provider="google", email_verified=True)
    assert empty.value.code == "allowlist_empty"


def test_google_callback_enforces_allowlist(monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(config, "GOOGLE_CLIENT_SECRET", "sec")
    monkeypatch.setattr(config, "SESSION_SECRET", "test-secret-key-32chars-minimum!!")
    monkeypatch.setattr(config, "ALLOWED_EMAILS", "coach@example.com")
    monkeypatch.setattr(config, "APP_BASE_URL", "http://localhost")
    monkeypatch.setattr(auth, "new_oauth_state", lambda: "fixed-state")

    async def exchange(provider, code):
        if code == "nope":
            email, verified = "stranger@example.com", True
        elif code == "unverified":
            email, verified = "coach@example.com", False
        else:
            email, verified = "Coach@Example.com", True
        return {
            "provider": "google",
            "sub": f"sub-{code}",
            "email": email,
            "email_verified": verified,
            "name": "Coach",
            "picture": None,
        }

    monkeypatch.setattr(main.oauth_providers, "exchange_code", exchange)
    client = TestClient(main.app)

    def callback(code: str):
        client.get("/api/auth/login/google", follow_redirects=False)
        return client.get(f"/api/auth/callback/google?code={code}&state=fixed-state", follow_redirects=False)

    denied = callback("nope")
    assert "auth_error=not_allowed" in denied.headers["location"]
    assert client.get("/api/auth/me").json()["user"] is None

    unverified = callback("unverified")
    assert "auth_error=unverified_email" in unverified.headers["location"]

    allowed = callback("ok")
    assert allowed.headers["location"].endswith("/")
    me = client.get("/api/auth/me").json()
    assert me["user"]["email"] == "Coach@Example.com"

    monkeypatch.setattr(config, "ALLOWED_EMAILS", "someone-else@example.com")
    assert client.get("/api/auth/me").json()["user"] is None
