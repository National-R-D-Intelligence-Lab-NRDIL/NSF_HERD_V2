"""
Usage-event logging -- page/tab views, institution selects, AI questions,
peer-filter changes, briefing exports, and session start/end.

Written to `v2_usage_events` in Supabase (isolated from v1's `usage_log`
table, which stays untouched). That table has RLS enabled with no
policies, so only the service_role key (held here, server-side only) can
write to it -- the frontend never talks to Supabase directly for this,
it always goes through this endpoint so the user_id/email on each row
comes from a verified JWT rather than whatever the client claims.

Fire-and-forget per CLAUDE.md's engineering principle ("Supabase calls
are fire-and-forget -- logging never crashes the app"): the frontend
caller never awaits/surfaces errors from this endpoint.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from config import settings

router = APIRouter(prefix="/usage", tags=["usage"])

ALLOWED_EVENTS = {
    "session_start",
    "session_end",
    "tab_view",
    "institution_view",
    "qa_question",
    "peer_filter_change",
    "briefing_export",
}


class LogEventRequest(BaseModel):
    event_type: str
    session_id: str | None = None
    institution: str | None = None
    tab: str | None = None
    question: str | None = None
    metadata: dict | None = None


@router.post("/log", status_code=204)
async def log_event(payload: LogEventRequest, user: dict = Depends(get_current_user)):
    if payload.event_type not in ALLOWED_EVENTS:
        raise HTTPException(status_code=422, detail=f"Unknown event_type: {payload.event_type}")

    row = {
        "user_id": user.get("user_id"),
        "email": user.get("email"),
        "session_id": payload.session_id,
        "event_type": payload.event_type,
        "institution": payload.institution,
        "tab": payload.tab,
        "question": payload.question,
        "metadata": payload.metadata,
    }
    url = f"{settings.supabase_url}/rest/v1/v2_usage_events"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, headers=headers, json=row, timeout=10)
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=resp.text)
