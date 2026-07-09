from fastapi import APIRouter, HTTPException, Request

from db import get_pool, rows_to_dicts

router = APIRouter(prefix="/federal", tags=["federal"])


def _parse_peer_ids(peer_ids: str | None) -> list[str] | None:
    if not peer_ids:
        return None
    ids = [p.strip() for p in peer_ids.split(",") if p.strip()]
    return ids or None


@router.get("/{inst_id}")
async def get_agency_breakdown(inst_id: str, year: int = 2024):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT af.agency_code, af.agency_name, af.amount, "
            "ROUND(af.amount * 100.0 / NULLIF(i.federal, 0), 1) AS pct_of_federal "
            "FROM stg_agency_funding af "
            "JOIN stg_institutions i ON af.inst_id = i.inst_id AND af.year = i.year "
            "WHERE af.inst_id = $1 AND af.year = $2 ORDER BY af.amount DESC",
            inst_id, year,
        )
    if not rows:
        raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={year}")
    return rows_to_dicts(rows)


@router.get("/{inst_id}/trend")
async def get_agency_trend(inst_id: str, start: int = 2019, end: int = 2024):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT year, agency_code, agency_name, amount FROM stg_agency_funding "
            "WHERE inst_id = $1 AND year BETWEEN $2 AND $3 ORDER BY year, amount DESC",
            inst_id, start, end,
        )
    return rows_to_dicts(rows)


@router.get("/{inst_id}/concentration")
async def get_agency_concentration(inst_id: str, year: int = 2024):
    """Herfindahl-Hirschman Index (HHI) of federal funding concentration,
    plus this institution's percentile vs. all others that year."""
    pool = get_pool()
    async with pool.acquire() as conn:
        agencies = await conn.fetch(
            "SELECT af.agency_code, af.agency_name, af.amount, "
            "ROUND(af.amount * 100.0 / NULLIF(i.federal, 0), 1) AS pct_of_federal "
            "FROM stg_agency_funding af "
            "JOIN stg_institutions i ON af.inst_id = i.inst_id AND af.year = i.year "
            "WHERE af.inst_id = $1 AND af.year = $2 ORDER BY af.amount DESC",
            inst_id, year,
        )
        if not agencies:
            raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={year}")

        all_top_pcts = await conn.fetch(
            """
            WITH inst_top AS (
                SELECT inst_id, MAX(amount) AS top_amount, SUM(amount) AS total_fed
                FROM stg_agency_funding WHERE year = $1
                GROUP BY inst_id HAVING SUM(amount) > 0
            )
            SELECT ROUND(top_amount * 100.0 / total_fed, 1) AS top_pct
            FROM inst_top ORDER BY top_pct
            """,
            year,
        )

    shares = [float(a["pct_of_federal"]) / 100.0 for a in agencies]
    hhi = sum(s ** 2 for s in shares)
    max_diverse = 1.0 - (1.0 / 7.0)
    diversification = round((1.0 - hhi) / max_diverse * 100, 1)

    top_agency = agencies[0]["agency_name"]
    top_pct = float(agencies[0]["pct_of_federal"])

    top_pcts = [float(r["top_pct"]) for r in all_top_pcts]
    percentile = (
        round(sum(1 for p in top_pcts if p < top_pct) / len(top_pcts) * 100)
        if top_pcts else 0
    )

    return {
        "hhi": round(hhi, 4),
        "diversification_score": diversification,
        "top_agency": top_agency,
        "top_agency_pct": top_pct,
        "national_percentile": percentile,
        "total_institutions": len(top_pcts),
    }


@router.get("/{inst_id}/peer-comparison")
async def get_agency_peer_comparison(
    inst_id: str, request: Request, year: int = 2024, n: int | None = None, peer_ids: str | None = None,
):
    """How the institution's federal agency mix compares to its peer group's
    average — ported from v1's get_agency_peer_comparison()."""
    bench = request.app.state.benchmarker
    custom = _parse_peer_ids(peer_ids)
    try:
        peers = custom if custom else bench.get_peer_inst_ids(inst_id, n=n)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not peers:
        return {"comparison": [], "custom_peer_mode": bool(custom)}

    all_ids = [inst_id] + peers
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT af.inst_id, af.agency_code, af.agency_name,
                   ROUND(af.amount * 100.0 / NULLIF(
                       (SELECT SUM(amount) FROM stg_agency_funding
                        WHERE inst_id = af.inst_id AND year = af.year), 0
                   ), 1) AS agency_pct
            FROM stg_agency_funding af
            WHERE af.inst_id = ANY($1::text[]) AND af.year = $2
            """,
            all_ids, year,
        )
    if not rows:
        return {"comparison": [], "custom_peer_mode": bool(custom)}

    data = rows_to_dicts(rows)
    target = {r["agency_code"]: r for r in data if r["inst_id"] == inst_id}
    peer_rows = [r for r in data if r["inst_id"] != inst_id]

    peer_sums: dict[str, dict] = {}
    for r in peer_rows:
        ac = r["agency_code"]
        entry = peer_sums.setdefault(ac, {"agency_name": r["agency_name"], "sum": 0.0, "count": 0})
        entry["sum"] += float(r["agency_pct"] or 0)
        entry["count"] += 1

    agency_codes = set(target) | set(peer_sums)
    result = []
    for ac in agency_codes:
        t = target.get(ac)
        p = peer_sums.get(ac)
        your_pct = float(t["agency_pct"]) if t and t["agency_pct"] is not None else 0.0
        agency_name = (t["agency_name"] if t else p["agency_name"]) if (t or p) else ac
        peer_avg_pct = round(p["sum"] / p["count"], 1) if p and p["count"] else 0.0
        result.append({
            "agency_code": ac,
            "agency_name": agency_name,
            "your_pct": round(your_pct, 1),
            "peer_avg_pct": peer_avg_pct,
            "difference": round(your_pct - peer_avg_pct, 1),
        })
    result.sort(key=lambda r: r["difference"], reverse=True)
    return {"comparison": result, "custom_peer_mode": bool(custom)}
