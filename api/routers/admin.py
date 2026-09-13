"""
Admin user-management endpoints -- Kalyan's internal use only, not
pilot-facing (see CLAUDE.md "Next Priorities" #3).

Wraps the Supabase Admin API (list/invite/remove users) that was previously
run by hand via curl -- see CLAUDE.md "Auth -- Completed" for the manual
version this replaces. There is no role system in the app (see
docs/implementation-plan.md's unbuilt user_profiles/role sketch), so access
is gated to a small hardcoded allow-list rather than a database-backed
permission -- this is a single-operator tool, not a multi-admin feature.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from config import settings

router = APIRouter(prefix="/admin", tags=["admin"])

ADMIN_EMAILS = {"kalyan8358@gmail.com"}


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("email") not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _admin_headers() -> dict:
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


class InviteRequest(BaseModel):
    email: str
    redirect_to: str


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    url = f"{settings.supabase_url}/auth/v1/admin/users"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=_admin_headers(), timeout=10)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    data = resp.json()
    users = data.get("users", data) if isinstance(data, dict) else data
    return [
        {
            "id": u["id"],
            "email": u.get("email"),
            "created_at": u.get("created_at"),
            "invited_at": u.get("invited_at"),
            "last_sign_in_at": u.get("last_sign_in_at"),
        }
        for u in users
    ]


@router.post("/users/invite")
async def invite_user(payload: InviteRequest, _: dict = Depends(require_admin)):
    # redirect_to must be a query param, not a body field -- Supabase's GoTrue
    # API (and the official JS/Python SDKs) read it from the query string.
    # A body field is silently ignored and GoTrue falls back to the project's
    # default Site URL instead, landing invitees on login instead of the
    # password-setup page.
    url = f"{settings.supabase_url}/auth/v1/invite"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            headers=_admin_headers(),
            params={"redirect_to": payload.redirect_to},
            json={"email": payload.email},
            timeout=10,
        )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.delete("/users/{user_id}")
async def remove_user(user_id: str, _: dict = Depends(require_admin)):
    url = f"{settings.supabase_url}/auth/v1/admin/users/{user_id}"
    async with httpx.AsyncClient() as client:
        resp = await client.delete(url, headers=_admin_headers(), timeout=10)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return {"status": "deleted"}
