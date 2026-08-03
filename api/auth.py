"""
JWT authentication dependency for FastAPI.

Validates Supabase-issued JWTs on protected endpoints (QA, briefing,
LLM-backed institution endpoints). Data endpoints (institutions, peers,
portfolio, federal) remain open — HERD data is public and the institution
picker must load before auth resolves on the frontend.

This Supabase project signs tokens with an asymmetric key (ES256),
verifiable against its public JWKS endpoint — there is no shared HS256
secret. The JWKS is fetched once at API startup (see main.py's lifespan)
and cached here.

If SUPABASE_URL is not set (local dev without Supabase), the dependency
returns a placeholder user so protected endpoints keep working.
"""

import json
import urllib.request

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import settings

_bearer = HTTPBearer(auto_error=False)
_jwks: dict | None = None


def fetch_jwks() -> None:
    """Fetch and cache the project's public JWKS. Called once at API startup."""
    global _jwks
    if not settings.supabase_url:
        return
    url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
    with urllib.request.urlopen(url, timeout=10) as resp:
        _jwks = json.load(resp)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Return the authenticated user payload, or raise 401.

    Returns a dict with at least: user_id (str), email (str).
    """
    if not settings.supabase_url:
        # Auth not configured — passthrough for local dev.
        return {"user_id": "dev", "email": "dev@localhost"}

    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not _jwks:
        raise HTTPException(status_code=503, detail="Auth signing keys not loaded")

    try:
        header = jwt.get_unverified_header(credentials.credentials)
        key = next((k for k in _jwks["keys"] if k["kid"] == header.get("kid")), None)
        if key is None:
            raise HTTPException(status_code=401, detail="Invalid token: unknown signing key")
        payload = jwt.decode(
            credentials.credentials,
            key,
            algorithms=[key["alg"]],
            audience="authenticated",
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token: missing subject")

    return {"user_id": user_id, "email": payload.get("email", "")}
