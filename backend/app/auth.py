"""Signed session cookies and OAuth user resolution.

Google (or GitHub) proves who the account is. ALLOWED_EMAILS is the separate
decision of whether that person may use IAssistant.
"""
from __future__ import annotations

import hmac
import re
import secrets
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
    """Protected resources need a signed-in user unless AUTH_REQUIRED is turned off."""
    return config.AUTH_REQUIRED


class AllowlistError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def allowed_email_set() -> frozenset[str]:
    parts = re.split(r"[,;\s]+", config.ALLOWED_EMAILS or "")
    return frozenset(part.strip().lower() for part in parts if "@" in part)


def email_allowed(email: str | None) -> bool:
    normalized = (email or "").strip().lower()
    allowed = allowed_email_set()
    return bool(normalized) and normalized in allowed


def check_allowed(email: str | None, *, provider: str, email_verified: bool | None) -> None:
    """Reject before a session is created. Empty allowlist allows nobody."""
    if not allowed_email_set():
        raise AllowlistError("allowlist_empty")
    if provider == "google" and email_verified is not True:
        raise AllowlistError("unverified_email")
    if not email_allowed(email):
        raise AllowlistError("not_allowed")


def password_accounts() -> dict[str, str]:
    """Approved email/password pairs. There is no sign-up; unknown addresses are rejected."""
    out: dict[str, str] = {}
    for part in re.split(r"[\n;]+", config.AUTH_PASSWORDS or ""):
        part = part.strip()
        if ":" not in part:
            continue
        email, password = part.split(":", 1)
        email = email.strip().lower()
        password = password.strip()
        if "@" in email and password:
            out[email] = password
    return out


def authenticate_password(email: str, password: str) -> str:
    """Return a user id for a provisioned account, or raise AllowlistError."""
    if not allowed_email_set():
        raise AllowlistError("allowlist_empty")
    normalized = (email or "").strip().lower()
    expected = password_accounts().get(normalized)
    given = password or ""
    probe = expected if expected else "invalid-password-placeholder"
    matched = hmac.compare_digest(probe.encode("utf-8"), given.encode("utf-8"))
    if not expected or not matched or not email_allowed(normalized):
        raise AllowlistError("invalid_credentials")
    return upsert_oauth_user("password", normalized, normalized, None, None)


def _admit(user: User | None) -> User | None:
    if not user:
        return None
    if allowed_email_set():
        return user if email_allowed(user.email) else None
    if required():
        return None
    return user


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
    return _admit(_row_to_user(row) if row else None)


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
    return _admit(_row_to_user(row) if row else None)


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
