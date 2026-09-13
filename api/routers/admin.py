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

import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from config import settings
from db import get_pool, rows_to_dicts

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


class UpdateUserSettingsRequest(BaseModel):
    ai_enabled: bool | None = None
    access_expires_at: str | None = None  # ISO date/datetime string, or null to clear


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
            "ai_enabled": (u.get("user_metadata") or {}).get("ai_enabled", True),
            "access_expires_at": (u.get("user_metadata") or {}).get("access_expires_at"),
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


@router.patch("/users/{user_id}")
async def update_user_settings(
    user_id: str, payload: UpdateUserSettingsRequest, _: dict = Depends(require_admin)
):
    # Supabase's admin update replaces user_metadata wholesale rather than
    # merging it, so fetch the current value first and merge in only the
    # fields this request explicitly sent (exclude_unset distinguishes
    # "field omitted" from "field explicitly set to null", e.g. to clear
    # access_expires_at).
    url = f"{settings.supabase_url}/auth/v1/admin/users/{user_id}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=_admin_headers(), timeout=10)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    current_metadata = resp.json().get("user_metadata") or {}
    merged_metadata = {**current_metadata, **payload.model_dump(exclude_unset=True)}

    async with httpx.AsyncClient() as client:
        resp = await client.put(
            url, headers=_admin_headers(), json={"user_metadata": merged_metadata}, timeout=10
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


@router.get("/data-status")
async def data_status(_: dict = Depends(require_admin)):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT year, loaded_at, source, row_counts, notes FROM data_loads ORDER BY year DESC"
        )
    years = rows_to_dicts(rows)
    for y in years:
        # asyncpg returns JSONB columns as raw text, not parsed dicts.
        if isinstance(y.get("row_counts"), str):
            y["row_counts"] = json.loads(y["row_counts"])

    loaded_years = sorted(r["year"] for r in years)
    gap_years = []
    if loaded_years:
        gap_years = [y for y in range(loaded_years[0], loaded_years[-1] + 1) if y not in loaded_years]

    return {"years": years, "gap_years": gap_years}
