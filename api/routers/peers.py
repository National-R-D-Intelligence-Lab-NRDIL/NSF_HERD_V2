from fastapi import APIRouter, HTTPException, Request

from db import get_pool

router = APIRouter(prefix="/peers", tags=["peers"])


def _parse_peer_ids(peer_ids: str | None) -> list[str] | None:
    if not peer_ids:
        return None
    ids = [p.strip() for p in peer_ids.split(",") if p.strip()]
    return ids or None


@router.get("/{inst_id}")
async def get_peers(inst_id: str, request: Request, n: int | None = None):
    bench = request.app.state.benchmarker
    try:
        peer_ids = bench.get_peer_inst_ids(inst_id, n=n)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"inst_id": inst_id, "peer_inst_ids": peer_ids}


@router.get("/{inst_id}/gap")
async def get_gap(inst_id: str, request: Request, n: int | None = None, peer_ids: str | None = None):
    bench = request.app.state.benchmarker
    custom = _parse_peer_ids(peer_ids)
    try:
        gaps = bench.analyze_gap_custom(inst_id, custom) if custom else bench.analyze_gap(inst_id, n=n)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"inst_id": inst_id, "gaps": gaps, "custom_peer_mode": bool(custom)}


@router.get("/{inst_id}/trend")
async def get_trend(
    inst_id: str,
    request: Request,
    start: int = 2019,
    end: int = 2024,
    n: int | None = None,
    peer_ids: str | None = None,
):
    bench = request.app.state.benchmarker
    pool = get_pool()
    custom = _parse_peer_ids(peer_ids)
    try:
        if custom:
            trend_df, stats = await bench.get_peer_trend_custom(
                inst_id, pool, custom, start_year=start, end_year=end
            )
        else:
            trend_df, stats = await bench.get_peer_trend(inst_id, pool, start_year=start, end_year=end, n=n)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "trend": trend_df.to_dict(orient="records"),
        "stats": stats,
        "custom_peer_mode": bool(custom),
    }
