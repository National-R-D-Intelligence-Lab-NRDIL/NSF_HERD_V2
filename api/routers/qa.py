"""
Natural language Q&A — ported from nsf-herd-mvp/src/query_engine.py.

Same pipeline as v1: question -> Gemini generates SQL -> execute read-only
against Postgres -> Gemini summarizes the result. What changed:
  - Table names point at the dbt staging views (stg_institutions, etc.)
    instead of raw SQLite tables. Columns are identical, so v1's few-shot
    SQL examples port over almost verbatim.
  - The CAGR pattern `POWER(x * 1.0 / y, 1.0/n)` works unmodified in
    Postgres because `1.0` is a NUMERIC literal, not a float — no cast
    needed (unlike the dbt CAGR macro, which broke because it explicitly
    cast to FLOAT first).
  - sqlite3 -> asyncpg. Generated SQL is a self-contained string (literal
    values, no placeholders), so it's just conn.fetch(sql).
"""

import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException
from google import genai
from pydantic import BaseModel

from auth import get_current_user
from config import settings
from db import get_pool, rows_to_dicts

router = APIRouter(prefix="/qa", tags=["qa"])

_client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None


# ======================================================================
# SCHEMA PROMPT — table names point at dbt staging views.
# ======================================================================
SCHEMA_PROMPT = """
=== DATABASE SCHEMA (Postgres) ===

Table: stg_institutions
  Primary key: (inst_id, year)
  - inst_id (TEXT): Institution identifier (e.g. '003594')
  - name (TEXT): Full institution name as reported by NSF
  - city (TEXT): City
  - state (TEXT): Two-letter state code (e.g. 'TX')
  - year (INTEGER): Fiscal year, range 2010-2024
  - total_rd (BIGINT): Total R&D expenditure in dollars
  - federal (BIGINT): Federal funding in dollars
  - state_local (BIGINT): State and local government funding in dollars
  - business (BIGINT): Business/industry funding in dollars
  - nonprofit (BIGINT): Nonprofit organization funding in dollars
  - institutional (BIGINT): Institution's own funding in dollars
  - other_sources (BIGINT): All other funding sources in dollars

Table: stg_field_expenditures
  Primary key: (inst_id, year, field_code)
  - inst_id (TEXT)
  - year (INTEGER): 2010-2024
  - field_code (TEXT): Short code for the field (see valid values below)
  - parent_field (TEXT): Parent field code this belongs to
  - is_parent (INTEGER): 1 = parent-level category, 0 = sub-field
  - field_name (TEXT): Full display name (e.g. 'Engineering, all')
  - federal (BIGINT): Federal R&D dollars in this field
  - nonfederal (BIGINT): Nonfederal R&D dollars
  - total (BIGINT): Total R&D dollars (federal + nonfederal)

Table: stg_agency_funding
  Primary key: (inst_id, year, agency_code)
  - inst_id (TEXT)
  - year (INTEGER): 2010-2024
  - agency_code (TEXT): One of: DOD, DOE, HHS, NASA, NSF, USDA, 'Other agencies'
  - agency_name (TEXT): Display name (e.g. 'Dept of Defense', 'HHS (incl. NIH)')
  - amount (BIGINT): Federal dollars from this agency

=== RELATIONSHIPS ===
- All 3 tables join on (inst_id, year)
- SUM(stg_field_expenditures.total WHERE is_parent=1) = stg_institutions.total_rd
- SUM(stg_agency_funding.amount) = stg_institutions.federal

=== VALID FIELD CODES ===

Parent fields (is_parent = 1):
  cs, engineering, geosciences, life_sciences, math, physical_sciences,
  psychology, social_sciences, other_sciences, non_se

Sub-fields (is_parent = 0):
  Engineering: eng_aerospace, eng_biomedical, eng_chemical, eng_civil,
    eng_electrical, eng_industrial, eng_mechanical, eng_materials, eng_other
  Life Sciences: life_agricultural, life_biomedical, life_health,
    life_natural_resources, life_other
  Physical Sciences: phys_astronomy, phys_chemistry, phys_materials,
    phys_physics, phys_other
  Social Sciences: soc_anthropology, soc_economics, soc_political,
    soc_sociology, soc_other
  Non-S&E: nse_business, nse_communication, nse_education, nse_humanities,
    nse_law, nse_social_work, nse_arts, nse_other
  Geosciences: geo_atmospheric, geo_earth, geo_ocean, geo_other

Note: cs, math, psychology, other_sciences have NO sub-fields.
Note: Missing field rows = $0 (institutions only report active fields).

=== VALID AGENCY CODES ===
  DOD, DOE, HHS, NASA, NSF, USDA, 'Other agencies'
  Note: HHS includes NIH. The survey does not break out NIH separately.

=== COMMON ALIASES ===
Field aliases:
  "biomedical engineering", "BME" -> field_code = 'eng_biomedical'
  "comp sci", "CS" -> field_code = 'cs'
  "econ", "economics" -> field_code = 'soc_economics'
  "poli sci", "political science" -> field_code = 'soc_political'
  "physics" -> field_code = 'phys_physics'
  "chemistry", "chem" -> field_code = 'phys_chemistry'
  "astronomy", "astro" -> field_code = 'phys_astronomy'
  "bio", "biology" -> field_code = 'life_sciences' (parent) or check sub-fields
  "ag", "agriculture" -> field_code = 'life_agricultural'
  "health sciences" -> field_code = 'life_health'
  "non-science", "non-S&E", "humanities" -> field_code = 'non_se' (parent) or 'nse_humanities'
  "materials", "materials science" -> field_code = 'phys_materials' (available from 2016 only)

Agency aliases:
  "NIH", "National Institutes of Health" -> agency_code = 'HHS' (NIH is part of HHS)
  "Pentagon", "military", "defense" -> agency_code = 'DOD'
  "energy" -> agency_code = 'DOE'
  "agriculture" -> agency_code = 'USDA'
  "space" -> agency_code = 'NASA'

=== SUB-FIELDS ADDED IN 2016 ===
These 4 sub-fields have NO DATA before 2016. Never compute CAGR with start year before 2016:
  eng_industrial, life_natural_resources, phys_materials, soc_anthropology

=== CRITICAL NAME MATCHING RULES ===
Institution names are INCONSISTENT across years. 259 institutions changed
names over the 15-year survey period.

RULES:
1. When an inst_id is provided in context, ALWAYS filter by inst_id, not name.
2. When matching by name, use LIKE with wildcards specific enough to avoid
   false matches (e.g. '%Massachusetts Institute of Technology%', not '%MIT%').
3. For name output, prefer the latest-year name via a CTE:
   SELECT inst_id, name FROM stg_institutions WHERE year = (SELECT MAX(year) FROM stg_institutions)

=== CAGR FORMULA (Postgres) ===
ROUND((POWER(end_value * 1.0 / NULLIF(start_value, 0), 1.0 / num_years) - 1) * 100, 1)
Always protect against division by zero with NULLIF.
"""

FEW_SHOT_EXAMPLES = """
=== EXAMPLE QUERIES ===

Q: "Top 10 universities by total R&D in 2024"
SQL:
SELECT name, total_rd,
       RANK() OVER (ORDER BY total_rd DESC) as national_rank
FROM stg_institutions
WHERE year = 2024
ORDER BY total_rd DESC
LIMIT 10;

Q: "Which Texas schools grew faster than UNT from 2019 to 2024?"
Context: inst_id='003594' is the selected institution, state='TX', start_year=2019, end_year=2024
SQL:
WITH latest_names AS (
    SELECT inst_id, name FROM stg_institutions
    WHERE year = (SELECT MAX(year) FROM stg_institutions)
),
texas_cagr AS (
    SELECT i.inst_id,
           MAX(CASE WHEN i.year = 2019 THEN i.total_rd END) as rd_start,
           MAX(CASE WHEN i.year = 2024 THEN i.total_rd END) as rd_end,
           ROUND((POWER(
               MAX(CASE WHEN i.year = 2024 THEN i.total_rd END) * 1.0 /
               NULLIF(MAX(CASE WHEN i.year = 2019 THEN i.total_rd END), 0),
               1.0 / 5) - 1) * 100, 1) as cagr_5yr
    FROM stg_institutions i
    WHERE i.state = 'TX' AND i.year IN (2019, 2024)
    GROUP BY i.inst_id
    HAVING MAX(CASE WHEN i.year = 2019 THEN i.total_rd END) > 0
       AND MAX(CASE WHEN i.year = 2024 THEN i.total_rd END) > 0
),
unt_cagr AS (
    SELECT cagr_5yr FROM texas_cagr WHERE inst_id = '003594'
)
SELECT ln.name, tc.rd_start, tc.rd_end, tc.cagr_5yr,
       (SELECT cagr_5yr FROM unt_cagr) as unt_cagr
FROM texas_cagr tc
JOIN latest_names ln ON tc.inst_id = ln.inst_id
WHERE tc.cagr_5yr > (SELECT cagr_5yr FROM unt_cagr)
  AND tc.inst_id != '003594'
ORDER BY tc.cagr_5yr DESC;

Q: "Top 10 by engineering R&D in 2024"
SQL:
SELECT i.name, fe.total as engineering_rd,
       ROUND(fe.total * 100.0 / NULLIF(i.total_rd, 0), 1) as pct_of_portfolio,
       RANK() OVER (ORDER BY fe.total DESC) as engineering_rank
FROM stg_field_expenditures fe
JOIN stg_institutions i ON fe.inst_id = i.inst_id AND fe.year = i.year
WHERE fe.year = 2024 AND fe.field_code = 'engineering'
ORDER BY fe.total DESC
LIMIT 10;

Q: "Which universities get the most NSF funding in 2024?"
SQL:
SELECT i.name, af.amount as nsf_funding,
       ROUND(af.amount * 100.0 / NULLIF(i.federal, 0), 1) as pct_of_federal,
       RANK() OVER (ORDER BY af.amount DESC) as nsf_rank
FROM stg_agency_funding af
JOIN stg_institutions i ON af.inst_id = i.inst_id AND af.year = i.year
WHERE af.year = 2024 AND af.agency_code = 'NSF'
ORDER BY af.amount DESC
LIMIT 10;

Q: "What are the fastest growing sub-fields at UNT?"
Context: inst_id='003594', start_year=2019, end_year=2024
SQL:
WITH subfield_growth AS (
    SELECT fe.field_code, fe.field_name, fe.parent_field,
           MAX(CASE WHEN fe.year = 2019 THEN fe.total END) as rd_2019,
           MAX(CASE WHEN fe.year = 2024 THEN fe.total END) as rd_2024
    FROM stg_field_expenditures fe
    WHERE fe.inst_id = '003594' AND fe.is_parent = 0 AND fe.year IN (2019, 2024)
    GROUP BY fe.field_code, fe.field_name, fe.parent_field
    HAVING MAX(CASE WHEN fe.year = 2019 THEN fe.total END) > 0
       AND MAX(CASE WHEN fe.year = 2024 THEN fe.total END) > 0
)
SELECT field_name, rd_2019, rd_2024,
       rd_2024 - rd_2019 as absolute_change,
       ROUND((POWER(rd_2024 * 1.0 / rd_2019, 1.0 / 5) - 1) * 100, 1) as cagr_5yr
FROM subfield_growth
ORDER BY cagr_5yr DESC;

Q: "Where do we rank in engineering?" (context: inst_id='003594', state='TX')
-- COMPETITIVE BAND: rank by the specific metric, show ~8 above and ~7 below.
-- Include the selected institution IN the results with is_selected = 1.
SQL:
WITH latest_names AS (
    SELECT inst_id, name FROM stg_institutions
    WHERE year = (SELECT MAX(year) FROM stg_institutions)
),
eng_ranked AS (
    SELECT fe.inst_id, fe.total as engineering_rd,
           RANK() OVER (ORDER BY fe.total DESC) as eng_rank,
           COUNT(*) OVER () as total_institutions
    FROM stg_field_expenditures fe
    WHERE fe.year = 2024 AND fe.field_code = 'engineering'
      AND fe.total > 0
),
target AS (SELECT eng_rank FROM eng_ranked WHERE inst_id = '003594')
SELECT ln.name, er.engineering_rd, er.eng_rank,
       er.total_institutions,
       CASE WHEN er.inst_id = '003594' THEN 1 ELSE 0 END as is_selected
FROM eng_ranked er
JOIN latest_names ln ON er.inst_id = ln.inst_id
WHERE er.eng_rank BETWEEN (SELECT eng_rank FROM target) - 8
                       AND (SELECT eng_rank FROM target) + 7
ORDER BY er.eng_rank ASC;

Q: "Which states have the highest total R&D?"
SQL:
SELECT state,
       SUM(total_rd) as total_state_rd,
       COUNT(DISTINCT inst_id) as num_institutions,
       ROUND(SUM(total_rd) * 1.0 / COUNT(DISTINCT inst_id), 0) as avg_per_institution
FROM stg_institutions
WHERE year = 2024
GROUP BY state
ORDER BY total_state_rd DESC
LIMIT 15;
"""

VALID_FIELD_CODES = {
    'cs', 'engineering', 'geosciences', 'life_sciences', 'math',
    'physical_sciences', 'psychology', 'social_sciences', 'other_sciences', 'non_se',
    'eng_aerospace', 'eng_biomedical', 'eng_chemical', 'eng_civil',
    'eng_electrical', 'eng_industrial', 'eng_mechanical', 'eng_materials', 'eng_other',
    'life_agricultural', 'life_biomedical', 'life_health',
    'life_natural_resources', 'life_other',
    'phys_astronomy', 'phys_chemistry', 'phys_materials', 'phys_physics', 'phys_other',
    'soc_anthropology', 'soc_economics', 'soc_political', 'soc_sociology', 'soc_other',
    'nse_business', 'nse_communication', 'nse_education', 'nse_humanities',
    'nse_law', 'nse_social_work', 'nse_arts', 'nse_other',
    'geo_atmospheric', 'geo_earth', 'geo_ocean', 'geo_other',
}
VALID_AGENCY_CODES = {'DOD', 'DOE', 'HHS', 'NASA', 'NSF', 'USDA', 'Other agencies'}


class QARequest(BaseModel):
    question: str
    inst_id: str | None = None
    institution_name: str | None = None
    state: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    peer_inst_ids: list[str] | None = None


def _require_client():
    if _client is None:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured.")
    return _client


def _build_context_block(ctx: QARequest) -> str:
    lines = ["\n=== CURRENT SESSION CONTEXT ==="]
    if ctx.institution_name:
        lines.append(f"Selected institution: {ctx.institution_name}")
    if ctx.inst_id:
        lines.append(f"  inst_id = '{ctx.inst_id}' (use this for filtering, NOT name)")
    if ctx.state:
        lines.append(f"  state = '{ctx.state}'")
    if ctx.start_year and ctx.end_year:
        lines.append(f"Time window: {ctx.start_year} to {ctx.end_year}")
        lines.append(f"  Years between = {ctx.end_year - ctx.start_year}")
    if ctx.peer_inst_ids:
        lines.append(f"Peer inst_ids: {ctx.peer_inst_ids}")
    if ctx.inst_id:
        lines.append("")
        lines.append("IMPORTANT: When the question says 'this institution', 'my institution',")
        lines.append("'our', 'we', ALWAYS filter by inst_id = '%s' instead of name LIKE." % ctx.inst_id)
        lines.append(
            "CASE WHEN inst_id = '%s' THEN 1 ELSE 0 END as is_selected" % ctx.inst_id
        )
    return "\n".join(lines)


def _clean_sql(text: str) -> str:
    text = re.sub(r'```[\w]*\n?', '', text)
    text = re.sub(r'```', '', text)

    lines = text.split('\n')
    sql_lines = []
    found_start = False
    for line in lines:
        stripped = line.strip()
        if not found_start:
            if re.match(r'^(SELECT|INSERT|UPDATE|DELETE|WITH)', stripped, re.IGNORECASE):
                found_start = True
                sql_lines.append(stripped)
        else:
            if ';' in stripped:
                sql_lines.append(stripped.split(';')[0] + ';')
                break
            elif stripped and not stripped.startswith(('Note:', 'This', 'The', '--')):
                sql_lines.append(stripped)

    sql = '\n'.join(sql_lines).strip()
    if sql and not sql.endswith(';'):
        sql += ';'
    return sql


def _validate_codes(sql: str) -> tuple[bool, str]:
    field_matches = re.findall(r"field_code\s*=\s*'([^']+)'", sql, re.IGNORECASE)
    for code in field_matches:
        if code not in VALID_FIELD_CODES:
            prefix = code.split('_')[0] if '_' in code else code
            suggestions = sorted(c for c in VALID_FIELD_CODES if c.startswith(prefix + '_') or c == prefix)
            if not suggestions:
                suggestions = sorted(VALID_FIELD_CODES)
            return False, f"Invalid field_code '{code}'. Did you mean: {', '.join(suggestions)}?"

    agency_matches = re.findall(r"agency_code\s*=\s*'([^']+)'", sql, re.IGNORECASE)
    for code in agency_matches:
        if code not in VALID_AGENCY_CODES:
            return False, (
                f"Invalid agency_code '{code}'. Valid codes: {', '.join(sorted(VALID_AGENCY_CODES))}. "
                "NIH is part of HHS — use agency_code = 'HHS'."
            )
    return True, ""


async def _generate_content(prompt: str):
    client = _require_client()
    for attempt in range(3):
        try:
            return await client.aio.models.generate_content(
                model='gemini-3.5-flash', contents=prompt
            )
        except Exception as e:
            if '503' in str(e) and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            raise HTTPException(status_code=502, detail=f"Gemini request failed: {e}")


async def _execute_sql(sql: str):
    cleaned = sql.strip().upper()
    if not cleaned.startswith("SELECT") and not cleaned.startswith("WITH"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed.")
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)
    return rows_to_dicts(rows)


@router.post("/ask")
async def ask(request: QARequest, user: dict = Depends(get_current_user)):
    context_block = _build_context_block(request)

    prompt = f"""You are an expert SQL analyst for the NSF HERD (Higher Education Research & Development) database.
Given the schema and examples below, write a Postgres query to answer the user's question.

{SCHEMA_PROMPT}

{FEW_SHOT_EXAMPLES}

{context_block}

=== USER QUESTION ===
"{request.question}"

=== RULES ===
1. Return ONLY the SQL query. No explanation, no markdown.
2. Use clear, descriptive column aliases (e.g. 'engineering_rd' not 'total').
3. Always include institution names in results.
4. When an inst_id is provided in context, use it for filtering instead of name LIKE.
5. For name output, prefer the latest-year name using a CTE when joining across years.
6. Always protect against division by zero: use NULLIF(denominator, 0).
7. For growth calculations, require both start and end values to be > 0.
8. LIMIT results to a reasonable number (10-20) unless the user asks for all.
9. For field queries, specify is_parent = 1 for parent fields or is_parent = 0 for sub-fields.

SQL:"""

    response = await _generate_content(prompt)
    sql = _clean_sql(response.text)

    is_valid, code_error = _validate_codes(sql)
    if not is_valid:
        retry_prompt = f"""The following SQL has an invalid code. Fix it.

Original question: "{request.question}"

Failed SQL:
{sql}

Error: {code_error}

{context_block}

Write the corrected SQL query only:"""
        retry_response = await _generate_content(retry_prompt)
        retry_sql = _clean_sql(retry_response.text)
        is_valid_retry, _ = _validate_codes(retry_sql)
        if is_valid_retry:
            sql = retry_sql

    try:
        results = await _execute_sql(sql)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query failed: {e}")

    # Auto-retry once if empty results (common cause: bad name match, wrong code)
    if not results:
        retry_prompt = f"""The following SQL query returned 0 rows. Fix it.

Original question: "{request.question}"

Failed SQL:
{sql}

{context_block}

Common causes of empty results:
1. Name LIKE pattern too specific or too broad. Use inst_id when available.
2. Wrong field_code or agency_code.
3. Missing or wrong is_parent filter.
4. Year out of range (data is 2010-2024).

Write the corrected SQL query only:"""
        try:
            retry_response = await _generate_content(retry_prompt)
            retry_sql = _clean_sql(retry_response.text)
            if retry_sql and retry_sql != sql:
                retry_results = await _execute_sql(retry_sql)
                if retry_results:
                    sql, results = retry_sql, retry_results
        except Exception:
            pass  # keep original empty result rather than fail the request

    summary = await _summarize_results(request.question, results)
    return {"sql": sql, "results": results, "summary": summary}


async def _summarize_results(question: str, results: list[dict]) -> str:
    if not results:
        return "No data found for this query."

    row_count = len(results)
    results_text = "\n".join(str(r) for r in results[:20])

    prompt = f"""You are a research funding analyst. Based ONLY on this data, write a 2-3 sentence insight.

Question: {question}

Data ({row_count} rows):
{results_text}

Guidelines:
- Lead with the key finding
- Include specific numbers and dollar amounts
- Keep it direct, no filler words
- If there is an is_selected column, identify which row is the user's institution
  and frame the insight from their perspective (e.g. "You rank #119...")
- Use positioning language, not judgments. Say "ranked #119 of 487" not "low ranking."

Summary:"""

    response = await _generate_content(prompt)
    summary = response.text.strip()
    summary = " ".join(summary.split())
    return summary
