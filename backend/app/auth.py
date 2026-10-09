"""Signed session cookies and OAuth user resolution."""
from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request, WebSocket
from . import config
from . import db

SESSION_USER_KEY = "user_id"


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str | None
    picture: str | None
    provider: str


def oauth_enabled() -> bool:
    has_client = bool(config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET) or bool(
        config.GITHUB_CLIENT_ID and config.GITHUB_CLIENT_SECRET
    )
    return has_client and bool(config.SESSION_SECRET)


def required() -> bool:
    """When OAuth is configured, protected resources need a signed-in user."""
    return oauth_enabled()


def providers() -> list[str]:
    out: list[str] = []
    if config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET:
        out.append("google")
    if config.GITHUB_CLIENT_ID and config.GITHUB_CLIENT_SECRET:
        out.append("github")
    return out


def new_oauth_state() -> str:
    return secrets.token_urlsafe(32)


def login_user(request: Request, user_id: str) -> None:
    request.session[SESSION_USER_KEY] = user_id


def logout_user(request: Request) -> None:
    request.session.pop(SESSION_USER_KEY, None)


def user_id_from_request(request: Request) -> str | None:
    session = request.scope.get("session")
    if not isinstance(session, dict):
        return None
    uid = session.get(SESSION_USER_KEY)
    return str(uid) if uid else None


def user_from_request(request: Request) -> User | None:
    uid = user_id_from_request(request)
    if not uid:
        return None
    row = db.get_user(uid)
    return _row_to_user(row) if row else None


def session_from_scope(scope) -> dict:
    """Decode Starlette session cookie (matches SessionMiddleware signer format)."""
    secret = config.SESSION_SECRET or "dev-session-not-for-production"
    from base64 import b64decode
    import json
    from http.cookies import SimpleCookie
    from itsdangerous import BadSignature, TimestampSigner

    raw = None
    for name, value in scope.get("headers", []):
        if name.lower() == b"cookie":
            raw = value.decode("latin-1")
            break
    if not raw:
        return {}
    jar = SimpleCookie()
    jar.load(raw)
    if "session" not in jar:
        return {}
    signer = TimestampSigner(secret)
    try:
        payload = signer.unsign(jar["session"].value.encode("utf-8"), max_age=14 * 24 * 60 * 60)
        data = json.loads(b64decode(payload))
        return data if isinstance(data, dict) else {}
    except BadSignature:
        return {}


def user_from_ws(ws: WebSocket) -> User | None:
    session = session_from_scope(ws.scope)
    uid = session.get(SESSION_USER_KEY)
    if not uid:
        return None
    row = db.get_user(str(uid))
    return _row_to_user(row) if row else None


def require_user(request: Request) -> User:
    user = user_from_request(request)
    if not user:
        raise HTTPException(
            status_code=401,
            detail={"error": "Sign in required.", "hint": "Use Sign in on the home page to link your account."},
        )
    return user


def assert_meeting_access(meeting_id: str, user: User | None) -> None:
    if not required():
        return
    if not user:
        raise HTTPException(status_code=401, detail={"error": "Sign in required."})
    if not db.meeting_owned_by(meeting_id, user.id):
        raise HTTPException(status_code=404, detail={"error": "Meeting not found."})


def _row_to_user(row: dict[str, Any]) -> User:
    return User(
        id=str(row["id"]),
        email=row["email"],
        name=row.get("name"),
        picture=row.get("picture"),
        provider=row["oauth_provider"],
    )


def public_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "provider": user.provider,
    }


def upsert_oauth_user(provider: str, sub: str, email: str, name: str | None, picture: str | None) -> str:
    uid = db.upsert_user(provider, sub, email, name, picture)
    if not uid:
        raise HTTPException(status_code=503, detail={"error": "Database unavailable."})
    return uid
