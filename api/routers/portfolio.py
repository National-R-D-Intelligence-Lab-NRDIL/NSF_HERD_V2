from fastapi import APIRouter, HTTPException, Request

from db import get_pool, rows_to_dicts

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


def _parse_peer_ids(peer_ids: str | None) -> list[str] | None:
    if not peer_ids:
        return None
    ids = [p.strip() for p in peer_ids.split(",") if p.strip()]
    return ids or None


@router.get("/{inst_id}")
async def get_field_portfolio(inst_id: str, year: int = 2024):
    """Parent-field breakdown for an institution (from mart_field_portfolio,
    which dbt already joined against inst_total_rd and computed field_share_pct)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT field_code, field_name, federal, nonfederal, field_total, field_share_pct "
            "FROM mart_field_portfolio WHERE inst_id = $1 AND year = $2 ORDER BY field_total DESC",
            inst_id, year,
        )
    if not rows:
        raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={year}")
    return rows_to_dicts(rows)


@router.get("/{inst_id}/drilldown")
async def get_field_drilldown(inst_id: str, parent_field: str, year: int = 2024):
    """Sub-field breakdown for one parent field."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT fe.field_code, fe.field_name, fe.federal, fe.nonfederal, fe.total, "
            "ROUND(fe.total * 100.0 / NULLIF(parent.total, 0), 1) AS share_of_parent "
            "FROM stg_field_expenditures fe "
            "LEFT JOIN stg_field_expenditures parent "
            "  ON parent.inst_id = fe.inst_id AND parent.year = fe.year "
            "  AND parent.field_code = fe.parent_field AND parent.is_parent = 1 "
            "WHERE fe.inst_id = $1 AND fe.year = $2 AND fe.parent_field = $3 AND fe.is_parent = 0 "
            "ORDER BY fe.total DESC",
            inst_id, year, parent_field,
        )
    return rows_to_dicts(rows)


@router.get("/{inst_id}/momentum")
async def get_field_momentum(inst_id: str, start: int = 2019, end: int = 2024):
    """CAGR per parent field between two years."""
    pool = get_pool()
    years_diff = end - start
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH latest AS (
                SELECT field_code, field_name, field_total, field_share_pct
                FROM mart_field_portfolio WHERE inst_id = $1 AND year = $2
            ),
            growth AS (
                SELECT field_code,
                       MAX(CASE WHEN year = $3 THEN total END) AS rd_start,
                       MAX(CASE WHEN year = $2 THEN total END) AS rd_end
                FROM stg_field_expenditures
                WHERE inst_id = $1 AND is_parent = 1 AND year IN ($2, $3)
                GROUP BY field_code
            )
            SELECT l.field_code, l.field_name, l.field_total, l.field_share_pct,
                   CASE WHEN g.rd_start > 0 AND g.rd_end > 0
                        THEN ROUND((POWER(g.rd_end::numeric / g.rd_start, 1.0 / $4) - 1) * 100, 1)
                        ELSE NULL END AS cagr_pct
            FROM latest l
            LEFT JOIN growth g ON l.field_code = g.field_code
            ORDER BY l.field_total DESC
            """,
            inst_id, end, start, years_diff,
        )
    return rows_to_dicts(rows)


@router.get("/{inst_id}/peer-comparison")
async def get_field_peer_comparison(
    inst_id: str, request: Request, year: int = 2024, n: int | None = None, peer_ids: str | None = None,
):
    """How the institution's field mix (portfolio share %) compares to its peer
    group's average — ported from v1's get_field_peer_comparison(). Peer group is
    either the explicit custom peer_ids or the fitted KNN benchmarker's peers."""
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
            SELECT fe.inst_id, fe.field_code, fe.field_name,
                   fe.total,
                   ROUND(fe.total * 100.0 / NULLIF(
                       (SELECT SUM(total) FROM stg_field_expenditures
                        WHERE inst_id = fe.inst_id AND year = fe.year AND is_parent = 1), 0
                   ), 1) AS portfolio_pct
            FROM stg_field_expenditures fe
            WHERE fe.inst_id = ANY($1::text[]) AND fe.year = $2 AND fe.is_parent = 1
            """,
            all_ids, year,
        )
    if not rows:
        return {"comparison": [], "custom_peer_mode": bool(custom)}

    data = rows_to_dicts(rows)
    target = {r["field_code"]: r for r in data if r["inst_id"] == inst_id}
    peer_rows = [r for r in data if r["inst_id"] != inst_id]

    peer_sums: dict[str, dict] = {}
    for r in peer_rows:
        fc = r["field_code"]
        entry = peer_sums.setdefault(fc, {"field_name": r["field_name"], "sum": 0.0, "count": 0})
        entry["sum"] += float(r["portfolio_pct"] or 0)
        entry["count"] += 1

    field_codes = set(target) | set(peer_sums)
    result = []
    for fc in field_codes:
        t = target.get(fc)
        p = peer_sums.get(fc)
        your_pct = float(t["portfolio_pct"]) if t and t["portfolio_pct"] is not None else 0.0
        your_total = float(t["total"]) if t else 0.0
        peer_avg_pct = round(p["sum"] / p["count"], 1) if p and p["count"] else 0.0
        field_name = (t["field_name"] if t else p["field_name"]) if (t or p) else fc
        result.append({
            "field_code": fc,
            "field_name": field_name,
            "your_pct": round(your_pct, 1),
            "your_total": your_total,
            "peer_avg_pct": peer_avg_pct,
            "difference": round(your_pct - peer_avg_pct, 1),
        })
    result.sort(key=lambda r: r["difference"], reverse=True)
    return {"comparison": result, "custom_peer_mode": bool(custom)}
