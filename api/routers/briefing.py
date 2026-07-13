"""
Narrative briefing endpoint (Feature 4, Option "a" scope -- see docs/decisions.md).

Returns structured JSON only; PDF rendering happens client-side via
jsPDF, keeping this endpoint lightweight (no fpdf2 or other heavy PDF
dependency on the server).
"""

from fastapi import APIRouter, Request

from db import get_pool
from services.narrative import generate_briefing

router = APIRouter(prefix="/briefing", tags=["briefing"])


@router.get("/{inst_id}")
async def get_briefing(
    inst_id: str,
    request: Request,
    start: int = 2019,
    end: int = 2024,
    n: int | None = None,
    peer_ids: str | None = None,
):
    """Generate a one-page research positioning briefing. Uses whichever
    peer group (KNN or custom) is currently active -- same principle as
    /institutions/{inst_id}/insight -- so the briefing always matches
    what's on screen."""
    pool = get_pool()
    bench = request.app.state.benchmarker
    custom = [p.strip() for p in peer_ids.split(",") if p.strip()] if peer_ids else None
    return await generate_briefing(inst_id, pool, bench, start, end, n=n, custom_peer_ids=custom)
