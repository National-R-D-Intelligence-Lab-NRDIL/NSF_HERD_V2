"""
JWT authentication dependency for FastAPI.

Validates Supabase-issued JWTs on protected endpoints (QA, briefing,
LLM-backed institution endpoints). Data endpoints (institutions, peers,
portfolio, federal) remain open — HERD data is public and the institution
picker must load before auth resolves on the frontend.

If SUPABASE_JWT_SECRET is not set (local dev without Supabase), the
dependency returns a placeholder user so protected endpoints keep working.
"""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import settings

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Return the authenticated user payload, or raise 401.

    Returns a dict with at least: user_id (str), email (str).
    """
    if not settings.supabase_jwt_secret:
        # Auth not configured — passthrough for local dev.
        return {"user_id": "dev", "email": "dev@localhost"}

    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token: missing subject")

    return {"user_id": user_id, "email": payload.get("email", "")}
