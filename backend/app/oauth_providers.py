"""OAuth2 authorization and token exchange (Google + GitHub)."""
from __future__ import annotations

import urllib.parse
from typing import Any

import httpx

from . import config

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo"

GITHUB_AUTH = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN = "https://github.com/login/oauth/access_token"
GITHUB_USER = "https://api.github.com/user"
GITHUB_EMAILS = "https://api.github.com/user/emails"


def redirect_uri(provider: str) -> str:
    base = config.APP_BASE_URL.rstrip("/")
    return f"{base}/api/auth/callback/{provider}"


def authorize_url(provider: str, state: str) -> str:
    if provider == "google":
        q = {
            "client_id": config.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri("google"),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
            "prompt": "select_account",
        }
        return f"{GOOGLE_AUTH}?{urllib.parse.urlencode(q)}"
    if provider == "github":
        q = {
            "client_id": config.GITHUB_CLIENT_ID,
            "redirect_uri": redirect_uri("github"),
            "scope": "read:user user:email",
            "state": state,
        }
        return f"{GITHUB_AUTH}?{urllib.parse.urlencode(q)}"
    raise ValueError(f"Unknown provider: {provider}")


async def exchange_code(provider: str, code: str) -> dict[str, Any]:
    if provider == "google":
        return await _google_user(code)
    if provider == "github":
        return await _github_user(code)
    raise ValueError(f"Unknown provider: {provider}")


async def _google_user(code: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        tok = await client.post(
            GOOGLE_TOKEN,
            data={
                "code": code,
                "client_id": config.GOOGLE_CLIENT_ID,
                "client_secret": config.GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri("google"),
                "grant_type": "authorization_code",
            },
        )
        tok.raise_for_status()
        access = tok.json().get("access_token")
        if not access:
            raise ValueError("Google token response missing access_token")
        ui = await client.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access}"})
        ui.raise_for_status()
        data = ui.json()
    sub = data.get("sub")
    email = data.get("email") or ""
    if not sub or not email:
        raise ValueError("Google profile missing sub or email")
    return {
        "provider": "google",
        "sub": str(sub),
        "email": email,
        "name": data.get("name"),
        "picture": data.get("picture"),
    }


async def _github_user(code: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        tok = await client.post(
            GITHUB_TOKEN,
            headers={"Accept": "application/json"},
            data={
                "client_id": config.GITHUB_CLIENT_ID,
                "client_secret": config.GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": redirect_uri("github"),
            },
        )
        tok.raise_for_status()
        access = tok.json().get("access_token")
        if not access:
            raise ValueError("GitHub token response missing access_token")
        headers = {"Authorization": f"Bearer {access}", "Accept": "application/vnd.github+json"}
        ui = await client.get(GITHUB_USER, headers=headers)
        ui.raise_for_status()
        data = ui.json()
        email = data.get("email")
        if not email:
            em = await client.get(GITHUB_EMAILS, headers=headers)
            em.raise_for_status()
            for row in em.json():
                if row.get("primary") and row.get("verified"):
                    email = row.get("email")
                    break
            if not email:
                for row in em.json():
                    if row.get("email"):
                        email = row["email"]
                        break
    sub = data.get("id")
    if not sub or not email:
        raise ValueError("GitHub profile missing id or email")
    return {
        "provider": "github",
        "sub": str(sub),
        "email": email,
        "name": data.get("name") or data.get("login"),
        "picture": data.get("avatar_url"),
    }
