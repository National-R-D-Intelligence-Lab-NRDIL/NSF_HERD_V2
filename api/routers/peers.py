from fastapi import APIRouter, HTTPException, Request

from db import get_pool
from services.benchmarker import PeerFilters

router = APIRouter(prefix="/peers", tags=["peers"])


def _parse_peer_ids(peer_ids: str | None) -> list[str] | None:
    if not peer_ids:
        return None
    ids = [p.strip() for p in peer_ids.split(",") if p.strip()]
    return ids or None


def _parse_filters(
    carnegie: str | None = None,
    control: str | None = None,
    exclude_med: bool = False,
    aau_only: bool = False,
    aplu_only: bool = False,
    hbcu_only: bool = False,
    hsi_only: bool = False,
    epscor_only: bool = False,
) -> PeerFilters | None:
    """Parse query params into a PeerFilters object. Returns None if no filters active."""
    carnegie_list = [c.strip() for c in carnegie.split(",") if c.strip()] if carnegie else None
    filters = PeerFilters(
        carnegie=carnegie_list,
        control=control,
        exclude_med=exclude_med,
        aau_only=aau_only,
        aplu_only=aplu_only,
        hbcu_only=hbcu_only,
        hsi_only=hsi_only,
        epscor_only=epscor_only,
    )
    return filters


@router.get("/{inst_id}")
async def get_peers(
    inst_id: str,
    request: Request,
    n: int | None = None,
    carnegie: str | None = None,
    control: str | None = None,
    exclude_med: bool = False,
    aau_only: bool = False,
    aplu_only: bool = False,
    hbcu_only: bool = False,
    hsi_only: bool = False,
    epscor_only: bool = False,
):
    bench = request.app.state.benchmarker
    filters = _parse_filters(carnegie, control, exclude_med, aau_only, aplu_only, hbcu_only, hsi_only, epscor_only)
    try:
        peer_ids = bench.get_peer_inst_ids(inst_id, n=n, filters=filters)
        pool_info = bench.get_candidate_pool_size(inst_id, filters=filters)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "inst_id": inst_id,
        "peer_inst_ids": peer_ids,
        "candidate_pool_size": pool_info,
    }


@router.get("/{inst_id}/gap")
async def get_gap(
    inst_id: str,
    request: Request,
    n: int | None = None,
    peer_ids: str | None = None,
    carnegie: str | None = None,
    control: str | None = None,
    exclude_med: bool = False,
    aau_only: bool = False,
    aplu_only: bool = False,
    hbcu_only: bool = False,
    hsi_only: bool = False,
    epscor_only: bool = False,
):
    bench = request.app.state.benchmarker
    custom = _parse_peer_ids(peer_ids)
    filters = _parse_filters(carnegie, control, exclude_med, aau_only, aplu_only, hbcu_only, hsi_only, epscor_only)
    try:
        if custom:
            gaps = bench.analyze_gap_custom(inst_id, custom)
        else:
            gaps = bench.analyze_gap(inst_id, n=n, filters=filters)
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
    carnegie: str | None = None,
    control: str | None = None,
    exclude_med: bool = False,
    aau_only: bool = False,
    aplu_only: bool = False,
    hbcu_only: bool = False,
    hsi_only: bool = False,
    epscor_only: bool = False,
):
    bench = request.app.state.benchmarker
    pool = get_pool()
    custom = _parse_peer_ids(peer_ids)
    filters = _parse_filters(carnegie, control, exclude_med, aau_only, aplu_only, hbcu_only, hsi_only, epscor_only)
    try:
        if custom:
            trend_df, stats = await bench.get_peer_trend_custom(
                inst_id, pool, custom, start_year=start, end_year=end
            )
        else:
            trend_df, stats = await bench.get_peer_trend(
                inst_id, pool, start_year=start, end_year=end, n=n, filters=filters
            )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "trend": trend_df.to_dict(orient="records"),
        "stats": stats,
        "custom_peer_mode": bool(custom),
    }
