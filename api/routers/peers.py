from fastapi import APIRouter, HTTPException, Request

from db import get_pool, rows_to_dicts
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


@router.get("/{inst_id}/movement")
async def get_peer_movement(
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
        active_peer_ids = custom if custom else bench.get_peer_inst_ids(inst_id, n=n, filters=filters)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    all_ids = [inst_id] + active_peer_ids
    n_years = end - start

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT inst_id, name, year, total_rd, national_rank "
            "FROM mart_rankings WHERE inst_id = ANY($1) AND year IN ($2, $3) "
            "ORDER BY inst_id, year",
            all_ids, start, end,
        )

    # Build {inst_id: {year: row_dict}}
    data: dict[str, dict[int, dict]] = {}
    for r in rows_to_dicts(rows):
        data.setdefault(r["inst_id"], {})[r["year"]] = r

    target_data = data.get(inst_id, {})
    target_rd_end = (target_data.get(end) or {}).get("total_rd")

    def _cagr(rd_s, rd_e):
        if rd_s and rd_e and rd_s > 0 and n_years > 0:
            return round(((rd_e / rd_s) ** (1 / n_years) - 1) * 100, 1)
        return None

    peers = []
    for pid in active_peer_ids:
        p_start = data.get(pid, {}).get(start, {})
        p_end = data.get(pid, {}).get(end, {})
        if not p_end:
            continue
        rank_s = p_start.get("national_rank")
        rank_e = p_end.get("national_rank")
        rd_s = p_start.get("total_rd")
        rd_e = p_end.get("total_rd")
        rank_delta = (rank_e - rank_s) if (rank_s is not None and rank_e is not None) else None
        dollar_gap = (rd_e - target_rd_end) if (rd_e is not None and target_rd_end is not None) else None
        peers.append({
            "inst_id": pid,
            "name": p_end.get("name", ""),
            "rank_start": rank_s,
            "rank_end": rank_e,
            "rank_delta": rank_delta,
            "total_rd_end": rd_e,
            "dollar_gap": dollar_gap,
            "cagr_pct": _cagr(rd_s, rd_e),
            "is_converging": bool(rank_delta is not None and rank_delta < 0 and rd_e and rd_s and rd_e > rd_s),
        })

    peers.sort(key=lambda p: (
        0 if p["is_converging"] else 1,
        abs(p["dollar_gap"]) if p["dollar_gap"] is not None else float("inf"),
    ))

    t_s = target_data.get(start, {})
    t_e = target_data.get(end, {})
    return {
        "inst_id": inst_id,
        "start": start,
        "end": end,
        "peers": peers,
        "target": {
            "rank_start": t_s.get("national_rank"),
            "rank_end": t_e.get("national_rank"),
            "rank_delta": (t_e["national_rank"] - t_s["national_rank"]) if t_s.get("national_rank") and t_e.get("national_rank") else None,
            "total_rd_end": target_rd_end,
            "cagr_pct": _cagr(t_s.get("total_rd"), t_e.get("total_rd")),
        },
        "custom_peer_mode": bool(custom),
    }


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
