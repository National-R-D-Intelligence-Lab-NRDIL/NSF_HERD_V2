from fastapi import APIRouter, Depends, HTTPException, Query, Request
from google import genai

from auth import get_current_user
from config import settings
from db import get_pool, rows_to_dicts

router = APIRouter(prefix="/institutions", tags=["institutions"])

_genai_client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None

# Same anchor positions used in v1's get_anchor_view.
ANCHOR_CANDIDATES = [1, 10, 25, 50, 100, 250, 500, 750]


@router.get("")
async def list_institutions(
    state: str | None = None,
    year: int = 2024,
    limit: int = Query(default=50, le=1500),
):
    """List institutions ranked by total R&D for a given year."""
    pool = get_pool()
    sql = "SELECT inst_id, name, state, year, total_rd, national_rank FROM mart_rankings WHERE year = $1"
    params = [year]
    if state:
        sql += " AND state = $2"
        params.append(state)
    sql += " ORDER BY national_rank LIMIT $%d" % (len(params) + 1)
    params.append(limit)

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return rows_to_dicts(rows)


@router.get("/{inst_id}")
async def get_institution(inst_id: str, year: int = 2024):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT inst_id, name, state, year, total_rd, federal, national_rank, state_rank "
            "FROM mart_rankings WHERE inst_id = $1 AND year = $2",
            inst_id, year,
        )
    if row is None:
        raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={year}")
    return rows_to_dicts([row])[0]


@router.get("/{inst_id}/rank")
async def get_rank_trend(inst_id: str, start: int = 2019, end: int = 2024):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT year, national_rank, total_rd FROM mart_rankings "
            "WHERE inst_id = $1 AND year BETWEEN $2 AND $3 ORDER BY year",
            inst_id, start, end,
        )
    return rows_to_dicts(rows)


@router.get("/{inst_id}/anchor")
async def get_anchor_view(inst_id: str, year: int = 2024):
    """Competitive-band view: target institution plus a handful of anchor
    ranks (#1, #10, #25... and neighbors) for the same year.

    mart_rankings already has national_rank precomputed, so unlike v1's
    get_anchor_view (which ran RANK() OVER on every call), this is a
    straight lookup + filter.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        target = await conn.fetchrow(
            "SELECT national_rank FROM mart_rankings WHERE inst_id = $1 AND year = $2",
            inst_id, year,
        )
        if target is None:
            raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={year}")
        target_rank = target["national_rank"]

        total_institutions = await conn.fetchval(
            "SELECT COUNT(*) FROM mart_rankings WHERE year = $1", year
        )

        anchors_above = [r for r in ANCHOR_CANDIDATES if r < target_rank and (target_rank - r) > 2]
        anchors_below = [r for r in ANCHOR_CANDIDATES if r > target_rank and (r - target_rank) > 2]
        selected = {1, total_institutions, target_rank}
        selected.update(anchors_above[-2:])
        selected.update(anchors_below[:2])

        rows = await conn.fetch(
            "SELECT inst_id, name, total_rd, national_rank FROM mart_rankings "
            "WHERE year = $1 AND national_rank = ANY($2::bigint[]) ORDER BY national_rank",
            year, list(selected),
        )

    result = rows_to_dicts(rows)
    for r in result:
        r["is_target"] = r["inst_id"] == inst_id
    return {"target_rank": target_rank, "total_institutions": total_institutions, "anchors": result}


@router.get("/{inst_id}/funding")
async def get_funding_breakdown(inst_id: str, start: int = 2019, end: int = 2024):
    pool = get_pool()
    async with pool.acquire() as conn:
        latest = await conn.fetchrow(
            "SELECT federal, state_local, business, nonprofit, institutional, "
            "other_sources, total_rd FROM stg_institutions WHERE inst_id = $1 AND year = $2",
            inst_id, end,
        )
        if latest is None:
            raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={end}")

        trend = await conn.fetch(
            "SELECT year, ROUND(federal * 100.0 / NULLIF(total_rd, 0), 1) AS federal_pct "
            "FROM stg_institutions WHERE inst_id = $1 AND year BETWEEN $2 AND $3 ORDER BY year",
            inst_id, start, end,
        )

        national_median = await conn.fetchval(
            "SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY federal * 100.0 / NULLIF(total_rd, 0)) "
            "FROM stg_institutions WHERE year = $1 AND total_rd > 0",
            end,
        )

    return {
        "breakdown": rows_to_dicts([latest])[0],
        "trend": rows_to_dicts(trend),
        "national_median_federal_pct": round(float(national_median), 1) if national_median else 0.0,
    }


@router.get("/{inst_id}/state-rank")
async def get_state_ranking(inst_id: str, year: int = 2024):
    pool = get_pool()
    async with pool.acquire() as conn:
        target = await conn.fetchrow(
            "SELECT state, state_rank, total_rd FROM mart_rankings WHERE inst_id = $1 AND year = $2",
            inst_id, year,
        )
        if target is None:
            raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={year}")

        state_rows = await conn.fetch(
            "SELECT inst_id, name, total_rd, state_rank FROM mart_rankings "
            "WHERE state = $1 AND year = $2 ORDER BY state_rank",
            target["state"], year,
        )
        total_state_rd = await conn.fetchval(
            "SELECT SUM(total_rd) FROM mart_rankings WHERE state = $1 AND year = $2",
            target["state"], year,
        )

    market_share = round(target["total_rd"] / total_state_rd * 100, 1) if total_state_rd else 0.0
    return {
        "state": target["state"],
        "state_rank": target["state_rank"],
        "market_share_pct": market_share,
        "institutions": rows_to_dicts(state_rows),
    }


@router.get("/{inst_id}/insight")
async def get_strategic_insight(
    inst_id: str,
    request: Request,
    start: int = 2019,
    end: int = 2024,
    n: int | None = None,
    peer_ids: str | None = None,
    user: dict = Depends(get_current_user),
):
    """LLM-generated strategic insight paragraph — ported from v1's
    generate_strategic_insight(). Uses whatever peer group (KNN or custom)
    the Peer Analysis section is currently showing, so the growth figures
    quoted here always match what's on screen."""
    if _genai_client is None:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured.")

    pool = get_pool()
    async with pool.acquire() as conn:
        rank_rows = await conn.fetch(
            "SELECT year, national_rank FROM mart_rankings WHERE inst_id = $1 AND year BETWEEN $2 AND $3 ORDER BY year",
            inst_id, start, end,
        )
        if not rank_rows:
            raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}")
        current_rank = rank_rows[-1]["national_rank"]
        start_rank = rank_rows[0]["national_rank"]

        funding_row = await conn.fetchrow(
            "SELECT ROUND(federal * 100.0 / NULLIF(total_rd, 0), 1) AS federal_pct "
            "FROM stg_institutions WHERE inst_id = $1 AND year = $2",
            inst_id, end,
        )
        federal_pct = float(funding_row["federal_pct"]) if funding_row and funding_row["federal_pct"] is not None else 0.0

        state_target = await conn.fetchrow(
            "SELECT state, state_rank FROM mart_rankings WHERE inst_id = $1 AND year = $2", inst_id, end,
        )
        state_rank = state_target["state_rank"] if state_target else None
        state = state_target["state"] if state_target else None

        top_field = await conn.fetchrow(
            "SELECT field_name, field_share_pct FROM mart_field_portfolio "
            "WHERE inst_id = $1 AND year = $2 ORDER BY field_total DESC LIMIT 1",
            inst_id, end,
        )
        top_agency = await conn.fetchrow(
            "SELECT af.agency_name, ROUND(af.amount * 100.0 / NULLIF(i.federal, 0), 1) AS pct_of_federal "
            "FROM stg_agency_funding af JOIN stg_institutions i ON af.inst_id = i.inst_id AND af.year = i.year "
            "WHERE af.inst_id = $1 AND af.year = $2 ORDER BY af.amount DESC LIMIT 1",
            inst_id, end,
        )

    field_context = ""
    if top_field:
        name = top_field["field_name"].replace(", all", "")
        field_context = f"- Largest field: {name} ({top_field['field_share_pct']}% of portfolio)"

    agency_context = ""
    if top_agency:
        agency_context = f"- Top federal agency: {top_agency['agency_name']} ({top_agency['pct_of_federal']}% of federal)"

    bench = request.app.state.benchmarker
    custom = [p.strip() for p in peer_ids.split(",") if p.strip()] if peer_ids else None
    target_growth = peer_avg = 0.0
    peer_desc = "peer avg"
    try:
        if custom:
            _, stats = await bench.get_peer_trend_custom(inst_id, pool, custom, start_year=start, end_year=end)
            peer_desc = "custom peer avg"
        else:
            _, stats = await bench.get_peer_trend(inst_id, pool, start_year=start, end_year=end, n=n)
            peer_desc = f"{n}-peer KNN avg" if n else "KNN peer avg"
        target_growth = stats["target_cagr"]
        peer_avg = stats["peer_avg_cagr"]
    except KeyError:
        pass

    prompt = f"""You are a senior research strategy analyst writing a briefing for a Vice President of Research. Write ONE concise paragraph (2-3 sentences, max 50 words) summarizing this institution's competitive position.

Data:
- Rank: #{current_rank} nationally (was #{start_rank} in {start})
- Growth (CAGR): {target_growth}% vs {peer_desc} {peer_avg}%
- Federal share: {federal_pct}% (national median available on request)
- State rank: #{state_rank} in {state}
{field_context}
{agency_context}

Rules:
- Use comparative positioning, not judgments. Say "ranked Nth" not "high risk."
- Never use words like risk, warning, concern, vulnerable, or should.
- State patterns and comparisons. Let the reader draw conclusions.
- Be specific with numbers. No filler.
- The growth comparison MUST reflect the actual numbers above. If target growth is below the peer avg, do NOT say it exceeds peers."""

    try:
        response = await _genai_client.aio.models.generate_content(model="gemini-2.5-flash", contents=prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini request failed: {e}")

    return {
        "insight": response.text.strip(),
        "target_growth": target_growth,
        "peer_avg": peer_avg,
        "peer_desc": peer_desc,
        "top_field": top_field["field_name"].replace(", all", "") if top_field else None,
        "top_field_pct": float(top_field["field_share_pct"]) if top_field else None,
        "top_agency": top_agency["agency_name"] if top_agency else None,
        "top_agency_pct": float(top_agency["pct_of_federal"]) if top_agency else None,
    }


@router.get("/{inst_id}/suggested-questions")
async def get_suggested_questions(
    inst_id: str,
    request: Request,
    start: int = 2019,
    end: int = 2024,
    n: int | None = None,
    peer_ids: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Rule-based, per-institution suggested questions for the Ask tab.

    Unlike v1 (static templates with only the state name swapped in), these
    are built from real computed markers — top/fastest-growing field, most
    distinctive field & agency vs. peers, nearest competitor by rank — so
    two different institutions get genuinely different suggestions."""
    pool = get_pool()
    bench = request.app.state.benchmarker
    custom = [p.strip() for p in peer_ids.split(",") if p.strip()] if peer_ids else None
    years_diff = max(end - start, 1)

    async with pool.acquire() as conn:
        rank_row = await conn.fetchrow(
            "SELECT state, state_rank, total_rd, national_rank FROM mart_rankings "
            "WHERE inst_id = $1 AND year = $2",
            inst_id, end,
        )
        if rank_row is None:
            raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={end}")
        current_rank = rank_row["national_rank"]
        state = rank_row["state"]

        top_field = await conn.fetchrow(
            "SELECT field_code, field_name, field_share_pct FROM mart_field_portfolio "
            "WHERE inst_id = $1 AND year = $2 ORDER BY field_total DESC LIMIT 1",
            inst_id, end,
        )

        top_agency = await conn.fetchrow(
            "SELECT af.agency_code, af.agency_name, "
            "ROUND(af.amount * 100.0 / NULLIF(i.federal, 0), 1) AS pct_of_federal "
            "FROM stg_agency_funding af JOIN stg_institutions i ON af.inst_id = i.inst_id AND af.year = i.year "
            "WHERE af.inst_id = $1 AND af.year = $2 ORDER BY af.amount DESC LIMIT 1",
            inst_id, end,
        )

        fastest_field = await conn.fetchrow(
            """
            WITH growth AS (
                SELECT field_code,
                       MAX(CASE WHEN year = $3 THEN total END) AS rd_start,
                       MAX(CASE WHEN year = $2 THEN total END) AS rd_end
                FROM stg_field_expenditures
                WHERE inst_id = $1 AND is_parent = 1 AND year IN ($2, $3)
                GROUP BY field_code
            )
            SELECT fp.field_name,
                   ROUND((POWER(g.rd_end::numeric / g.rd_start, 1.0 / $4) - 1) * 100, 1) AS cagr_pct
            FROM growth g
            JOIN mart_field_portfolio fp ON fp.inst_id = $1 AND fp.year = $2 AND fp.field_code = g.field_code
            WHERE g.rd_start > 0 AND g.rd_end > 0
            ORDER BY cagr_pct DESC LIMIT 1
            """,
            inst_id, end, start, years_diff,
        )

        try:
            peers = custom if custom else bench.get_peer_inst_ids(inst_id, n=n or 10)
        except KeyError:
            peers = []

        closest_peer = None
        distinctive_field = None
        distinctive_agency = None
        if peers:
            all_ids = [inst_id] + peers
            peer_rank_rows = await conn.fetch(
                "SELECT inst_id, name, total_rd, national_rank FROM mart_rankings "
                "WHERE inst_id = ANY($1::text[]) AND year = $2",
                all_ids, end,
            )
            others = [r for r in peer_rank_rows if r["inst_id"] != inst_id]
            if others:
                closest_peer = min(others, key=lambda r: abs(r["national_rank"] - current_rank))

            field_rows = await conn.fetch(
                """
                SELECT fe.inst_id, fe.field_code, fe.field_name,
                       ROUND(fe.total * 100.0 / NULLIF(
                           (SELECT SUM(total) FROM stg_field_expenditures
                            WHERE inst_id = fe.inst_id AND year = fe.year AND is_parent = 1), 0
                       ), 1) AS portfolio_pct
                FROM stg_field_expenditures fe
                WHERE fe.inst_id = ANY($1::text[]) AND fe.year = $2 AND fe.is_parent = 1
                """,
                all_ids, end,
            )
            distinctive_field = _most_distinctive(field_rows, inst_id, "field_code", "field_name", "portfolio_pct")

            agency_rows = await conn.fetch(
                """
                SELECT af.inst_id, af.agency_code, af.agency_name,
                       ROUND(af.amount * 100.0 / NULLIF(
                           (SELECT SUM(amount) FROM stg_agency_funding
                            WHERE inst_id = af.inst_id AND year = af.year), 0
                       ), 1) AS agency_pct
                FROM stg_agency_funding af
                WHERE af.inst_id = ANY($1::text[]) AND af.year = $2
                """,
                all_ids, end,
            )
            distinctive_agency = _most_distinctive(agency_rows, inst_id, "agency_code", "agency_name", "agency_pct")

    compare_qs = []
    if closest_peer:
        compare_qs.append(f"How do we compare to {closest_peer['name']} in total R&D funding?")
    if state:
        compare_qs.append(f"Which universities in {state} rank above us in R&D funding?")
    if not compare_qs:
        compare_qs.append("How does our total R&D funding compare to other universities nationally?")

    momentum_qs = []
    if fastest_field and fastest_field["cagr_pct"] and float(fastest_field["cagr_pct"]) > 0:
        fastest_name = fastest_field["field_name"].replace(", all", "")
        momentum_qs.append(f"What is driving the growth in {fastest_name}?")
    if top_agency:
        momentum_qs.append(f"How has our funding from {top_agency['agency_name']} changed over the last {years_diff} years?")
    if not momentum_qs:
        momentum_qs.append(f"How has our total R&D funding changed over the last {years_diff} years?")

    distinctive_qs = []
    if distinctive_field:
        distinctive_qs.append(f"How does our {distinctive_field.replace(', all', '')} funding compare to peer institutions?")
    elif top_field:
        name = top_field["field_name"].replace(", all", "")
        distinctive_qs.append(f"How does our {name} funding compare to peer institutions?")
    if distinctive_agency:
        distinctive_qs.append(f"How does our reliance on {distinctive_agency} compare to peer institutions?")
    elif top_agency:
        distinctive_qs.append(f"How does our reliance on {top_agency['agency_name']} compare to peer institutions?")
    if not distinctive_qs:
        distinctive_qs.append("Which fields make up most of our research portfolio?")

    return {
        "groups": [
            {"label": "How do we compare?", "questions": compare_qs[:2]},
            {"label": "Where's the momentum?", "questions": momentum_qs[:2]},
            {"label": "What's distinctive?", "questions": distinctive_qs[:2]},
        ]
    }


def _most_distinctive(rows, inst_id: str, code_key: str, name_key: str, pct_key: str) -> str | None:
    """Given rows of {inst_id, code, name, pct} for a target + peer group,
    return the display name of the field/agency where the target's share
    most exceeds the peer average — used to power 'distinctive' suggestions."""
    data = rows_to_dicts(rows)
    target = {r[code_key]: r for r in data if r["inst_id"] == inst_id}
    peer_rows = [r for r in data if r["inst_id"] != inst_id]

    peer_sums: dict[str, dict] = {}
    for r in peer_rows:
        code = r[code_key]
        entry = peer_sums.setdefault(code, {"name": r[name_key], "sum": 0.0, "count": 0})
        entry["sum"] += float(r[pct_key] or 0)
        entry["count"] += 1

    best_code = None
    best_diff = -1e9
    for code, t in target.items():
        your_pct = float(t[pct_key] or 0)
        p = peer_sums.get(code)
        peer_avg = (p["sum"] / p["count"]) if p and p["count"] else 0.0
        diff = your_pct - peer_avg
        if diff > best_diff and your_pct > 0:
            best_diff = diff
            best_code = code

    if best_code is None or best_diff <= 0:
        return None
    return target[best_code][name_key]
