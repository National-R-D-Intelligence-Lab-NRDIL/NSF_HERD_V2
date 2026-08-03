"""
Narrative briefing generator -- Feature 4 (Option "a" scope, per docs/decisions.md).

Builds a one-page, provost-ready research positioning briefing from data
that's already computable today: rank, CAGR vs. peers, portfolio signal,
federal signal. Deliberately does NOT invent scenario-modeling or
forward-projection claims (crossover years, "+$5M would move us to #132")
since Features 1 (Scenario Modeling) and 3 (Forward Projection) are not
built yet.

Uses whichever peer group (KNN or custom) is currently active, same
principle as institutions.py's /insight endpoint, so the briefing always
matches what's on screen.

Returns structured JSON only. PDF rendering happens client-side via
jsPDF -- this keeps the API lightweight (no fpdf2 or other heavy PDF
dependency on the server).
"""

import asyncio
import json
import re

import asyncpg
from fastapi import HTTPException
from google import genai

from config import settings

_client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None


def _require_client():
    if _client is None:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured.")
    return _client


async def _generate_content(prompt: str):
    client = _require_client()
    for attempt in range(3):
        try:
            return await client.aio.models.generate_content(
                model="gemini-3.5-flash", contents=prompt
            )
        except Exception as e:
            if "503" in str(e) and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            raise HTTPException(status_code=502, detail=f"Gemini request failed: {e}")


def _clean_json(text: str) -> dict:
    text = re.sub(r"```[\w]*\n?", "", text)
    text = re.sub(r"```", "", text).strip()
    return json.loads(text)


async def _gather_data(
    inst_id: str,
    pool: asyncpg.Pool,
    bench,
    start: int,
    end: int,
    n: int | None,
    custom_peer_ids: list[str] | None,
) -> dict:
    try:
        peer_ids = custom_peer_ids if custom_peer_ids else bench.get_peer_inst_ids(inst_id, n=n)
    except KeyError:
        peer_ids = []

    async with pool.acquire() as conn:
        rank_rows = await conn.fetch(
            "SELECT year, national_rank, state_rank, total_rd FROM mart_rankings "
            "WHERE inst_id = $1 AND year BETWEEN $2 AND $3 ORDER BY year",
            inst_id, start, end,
        )
        if not rank_rows:
            raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}")

        name_row = await conn.fetchrow(
            "SELECT name, state FROM stg_institutions WHERE inst_id = $1 AND year = $2",
            inst_id, end,
        )
        if name_row is None:
            raise HTTPException(status_code=404, detail=f"No data for inst_id={inst_id}, year={end}")

        funding_row = await conn.fetchrow(
            "SELECT ROUND(federal * 100.0 / NULLIF(total_rd, 0), 1) AS federal_pct "
            "FROM stg_institutions WHERE inst_id = $1 AND year = $2",
            inst_id, end,
        )
        national_median = await conn.fetchval(
            "SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY federal * 100.0 / NULLIF(total_rd, 0)) "
            "FROM stg_institutions WHERE year = $1 AND total_rd > 0",
            end,
        )

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

        current_rank = rank_rows[-1]["national_rank"]
        current_state_rank = rank_rows[-1]["state_rank"]
        total_rd = rank_rows[-1]["total_rd"]

        # Closest peer by rank within the active group, plus the current
        # dollar gap -- purely descriptive of where things stand today,
        # not a projection (Feature 3 is not built; no crossover-year claims).
        closest_peer = None
        peer_table = []
        if peer_ids:
            peer_rows = await conn.fetch(
                "SELECT inst_id, name, total_rd, national_rank FROM mart_rankings "
                "WHERE inst_id = ANY($1::text[]) AND year = $2",
                peer_ids, end,
            )
            if peer_rows:
                nearest = min(peer_rows, key=lambda r: abs(r["national_rank"] - current_rank))
                closest_peer = {
                    "name": nearest["name"],
                    "rank": nearest["national_rank"],
                    "gap_dollars": int(nearest["total_rd"]) - int(total_rd),
                }

                # Peer comparison table: target row + up to 7 nearest-by-rank
                # peers, sorted for display by absolute national rank.
                nearest_peers = sorted(
                    peer_rows, key=lambda r: abs(r["national_rank"] - current_rank)
                )[:7]
                table_rows = [
                    {
                        "name": name_row["name"],
                        "rank": current_rank,
                        "total_rd": int(total_rd),
                        "is_target": True,
                    }
                ] + [
                    {
                        "name": r["name"],
                        "rank": r["national_rank"],
                        "total_rd": int(r["total_rd"]),
                        "is_target": False,
                    }
                    for r in nearest_peers
                ]
                peer_table = sorted(table_rows, key=lambda r: r["rank"])

    # Peer growth stats -- bench manages its own pool.acquire() internally,
    # same as institutions.py's /insight endpoint.
    target_growth = peer_avg = 0.0
    growth_rank = total_in_group = None
    peer_desc = "peer avg"
    try:
        if custom_peer_ids:
            _, stats = await bench.get_peer_trend_custom(
                inst_id, pool, custom_peer_ids, start_year=start, end_year=end
            )
            peer_desc = "custom peer set"
        else:
            _, stats = await bench.get_peer_trend(inst_id, pool, start_year=start, end_year=end, n=n)
            peer_desc = f"{n}-peer benchmark set" if n else "benchmark peer set"
        target_growth = stats["target_cagr"]
        peer_avg = stats["peer_avg_cagr"]
        growth_rank = stats["growth_rank"]
        total_in_group = stats["total_in_group"]
    except KeyError:
        pass

    return {
        "institution_name": name_row["name"],
        "state": name_row["state"],
        "start_year": start,
        "end_year": end,
        "current_rank": current_rank,
        "start_rank": rank_rows[0]["national_rank"],
        "current_state_rank": current_state_rank,
        "total_rd": int(total_rd),
        "target_growth": target_growth,
        "peer_avg_growth": peer_avg,
        "peer_desc": peer_desc,
        "growth_rank": growth_rank,
        "total_in_group": total_in_group,
        "federal_pct": float(funding_row["federal_pct"]) if funding_row and funding_row["federal_pct"] is not None else 0.0,
        "national_median_federal_pct": round(float(national_median), 1) if national_median else 0.0,
        "top_field": top_field["field_name"].replace(", all", "") if top_field else None,
        "top_field_pct": float(top_field["field_share_pct"]) if top_field else None,
        "top_agency": top_agency["agency_name"] if top_agency else None,
        "top_agency_pct": float(top_agency["pct_of_federal"]) if top_agency else None,
        "closest_peer": closest_peer,
        "peer_table": peer_table,
        "rank_trend": [
            {
                "year": r["year"],
                "national_rank": r["national_rank"],
                "total_rd": int(r["total_rd"]),
            }
            for r in rank_rows
        ],
    }


async def generate_briefing(
    inst_id: str,
    pool: asyncpg.Pool,
    bench,
    start: int = 2019,
    end: int = 2024,
    n: int | None = None,
    custom_peer_ids: list[str] | None = None,
) -> dict:
    data = await _gather_data(inst_id, pool, bench, start, end, n, custom_peer_ids)

    growth_rank_context = ""
    if data["growth_rank"]:
        growth_rank_context = f"- Growth rank within peer group: #{data['growth_rank']} of {data['total_in_group']}"

    closest_peer_context = ""
    if data["closest_peer"]:
        cp = data["closest_peer"]
        direction = "ahead of" if cp["gap_dollars"] < 0 else "behind"
        closest_peer_context = (
            f"- Closest peer by rank: {cp['name']} (#{cp['rank']}), "
            f"${abs(cp['gap_dollars']):,} {direction} in total R&D"
        )

    field_context = ""
    if data["top_field"]:
        field_context = f"- Largest field: {data['top_field']} ({data['top_field_pct']}% of portfolio)"

    agency_context = ""
    if data["top_agency"]:
        agency_context = f"- Top federal agency: {data['top_agency']} ({data['top_agency_pct']}% of federal funding)"

    # Deterministic, non-LLM key metrics -- guaranteed factually accurate
    # since they're computed directly from the queried data, not generated.
    key_metrics = [
        {"label": "National Rank", "value": f"#{data['current_rank']} (FY{data['end_year']})"},
        {"label": "State Rank", "value": f"#{data['current_state_rank']} in {data['state']}"},
        {"label": "Total R&D", "value": f"${data['total_rd']:,}"},
        {
            "label": "Growth (CAGR)",
            "value": f"{data['target_growth']}% vs {data['peer_avg_growth']}% ({data['peer_desc']})",
        },
        {
            "label": "Federal Share",
            "value": f"{data['federal_pct']}% (nat'l median {data['national_median_federal_pct']}%)",
        },
        {
            "label": "Largest Field",
            "value": f"{data['top_field']} ({data['top_field_pct']}%)" if data["top_field"] else "—",
        },
    ]

    prompt = f"""You are a senior research strategy analyst preparing a one-page research positioning briefing for a Provost or Board of Trustees. This is a factual positioning summary, NOT a persuasive pitch.

Institution: {data['institution_name']} ({data['state']})
Reporting year: FY{data['end_year']}

Data:
- National rank: #{data['current_rank']} (was #{data['start_rank']} in FY{data['start_year']})
- State rank: #{data['current_state_rank']} in {data['state']}
- Total R&D: ${data['total_rd']:,}
- Growth (CAGR, FY{data['start_year']}-FY{data['end_year']}): {data['target_growth']}% vs {data['peer_desc']} average {data['peer_avg_growth']}%
{growth_rank_context}
{closest_peer_context}
- Federal share of R&D: {data['federal_pct']}% (national median: {data['national_median_federal_pct']}%)
{field_context}
{agency_context}

Write a JSON object with EXACTLY these keys, each a short plain-text value (no markdown):
- "headline": one sentence (max 30 words) stating the rank movement using neutral, factual language (e.g. "moved from #X to #Y"). Do NOT characterize the movement as "positive," "strong," or otherwise evaluative -- the growth comparison is described separately and may not support that framing.
- "growth_vs_peers": 1-2 sentences (max 45 words) comparing the institution's CAGR to its peer group, using the numbers above.
- "peer_landscape": 1-2 sentences (max 45 words) on where the institution sits relative to its closest peer by rank. If no closest peer data is given, describe the peer growth-rank standing instead.
- "portfolio_signal": 1-2 sentences (max 45 words) on the largest field and what it says about portfolio concentration.
- "federal_signal": 1-2 sentences (max 45 words) on federal funding share vs the national median and the top funding agency.

STRICT RULES:
1. Use ONLY the numbers given above. Do not invent, estimate, or extrapolate any figure not explicitly provided.
2. NEVER state or imply a future outcome, crossover year, or "at this rate" projection (e.g. "will overtake by FY2027") -- forward projection is out of scope for this briefing.
3. NEVER propose a hypothetical investment amount or its effect (e.g. "+$5M would move us to #132") -- scenario modeling is out of scope for this briefing.
4. Use comparative positioning language, not judgments. Never use words like risk, warning, concern, vulnerable, should, or recommend.
5. If growth is below the peer average, say so plainly -- do not spin it as a strength.
6. Be specific with the numbers given. No filler language.
7. Do not describe the overall trajectory as positive or successful if growth trails the peer average -- state the rank movement and the growth comparison as two separate, neutral facts and let the reader draw conclusions.

Return ONLY the JSON object, no markdown fences, no explanation."""

    response = await _generate_content(prompt)
    try:
        sections = _clean_json(response.text)
    except (json.JSONDecodeError, AttributeError):
        sections = {
            "headline": f"{data['institution_name']} ranks #{data['current_rank']} nationally in total R&D.",
            "growth_vs_peers": f"Grew at a {data['target_growth']}% CAGR vs {data['peer_avg_growth']}% for {data['peer_desc']}.",
            "peer_landscape": closest_peer_context.lstrip("- ") or growth_rank_context.lstrip("- "),
            "portfolio_signal": field_context.lstrip("- "),
            "federal_signal": agency_context.lstrip("- "),
        }

    return {
        "institution_name": data["institution_name"],
        "state": data["state"],
        "year": data["end_year"],
        "headline": sections.get("headline", ""),
        "sections": [
            {"title": "Growth vs. Peers", "body": sections.get("growth_vs_peers", "")},
            {"title": "Peer Landscape", "body": sections.get("peer_landscape", "")},
            {"title": "Portfolio Signal", "body": sections.get("portfolio_signal", "")},
            {"title": "Federal Funding Signal", "body": sections.get("federal_signal", "")},
        ],
        "footnote": (
            f"Source: NSF HERD survey data, FY{data['start_year']}-FY{data['end_year']}. "
            f"Peer comparisons reflect {data['peer_desc']}. "
            "This briefing describes current and historical positioning only; "
            "it does not include forward projections or investment scenario modeling."
        ),
        "key_metrics": key_metrics,
        "peer_table": data["peer_table"],
        "rank_trend": data["rank_trend"],
    }
