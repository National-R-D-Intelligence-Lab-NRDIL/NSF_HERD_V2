# NSF HERD v2 — Project Context Log

> Append-only. Each entry records what was built, why, and key decisions made. Source for future docs, articles, and diagrams.

---

## [Phase 1] Docker + Postgres Foundation — 2026-06-27

### What was built
- `docker-compose.yml` — runs Postgres in a container; one command starts the database
- `.env.example` — template for all environment variables (passwords, API keys)
- `scripts/seed.sql` — SQL that creates the 3 raw tables on first startup
- `scripts/load_seed_data.py` — migrates data from v1 SQLite into Postgres

### Why
v1 used SQLite (a file on disk). Moving to Postgres makes the database a proper server that the API, dbt, and DuckDB can all connect to simultaneously. Docker means any machine can run the exact same setup with one command — no manual Postgres installation.

### Key decisions
- **`raw_` table prefix** — raw tables are never modified after loading. dbt staging models read from them. Keeps the layers clean.
- **Named volume `pgdata`** — data persists when the container restarts. Without it, every restart wipes the database.
- **`seed.sql` via initdb.d** — Postgres auto-runs scripts in that folder on first start. Tables are created before any data is loaded.
- **Batch inserts + `ON CONFLICT DO NOTHING`** — loads ~298K rows efficiently and is safe to re-run without erroring on duplicates.

### Alternatives rejected
- Local Postgres install: works, but not reproducible across machines
- Neon (managed cloud): CLAUDE.md explicitly ruled it out — cold starts and 0.5GB limit

### Open questions
- Need to create `.gitignore` to exclude `.env` before first commit
- `load_seed_data.py` default path assumes `nsf-herd-mvp` sits next to `nsf-herd-v2` — may need `--sqlite` flag if folder structure differs

### Known shortcut (to revisit in Phase 5)
Phase 1 skipped the download step entirely. Instead of pulling fresh data from the NSF website, we copied already-transformed data from v1's `herd.db` SQLite file directly into Postgres. This was intentional — fastest way to get a working database for Phases 2–4. The proper ingestion pipeline (dlt + Dagster) replaces this in Phase 5.

---

## [Phase 2] dbt Core — 2026-06-28

### What was built
- `dbt/Dockerfile` — runs dbt inside Docker, nothing installed on the local machine
- `dbt/dbt_project.yml` — project config, materialization settings, default year window (2019–2024)
- `dbt/profiles.yml` — Postgres connection via environment variables
- `dbt/macros/cagr.sql` — reusable CAGR formula used across mart models
- `dbt/models/staging/` — 3 staging views (stg_institutions, stg_field_expenditures, stg_agency_funding)
- `dbt/models/marts/` — 5 mart tables (rankings, peer metrics, field portfolio, peer movement, trajectories)
- `dbt/models/staging/_staging.yml` — source definitions + column-level tests
- `dbt/models/marts/_marts.yml` — mart schema + tests
- `dbt/tests/assert_*.sql` — 3 custom data invariant tests

### Why
The 6 Python ETL scripts in v1 had no tests, no documentation, and no dependency tracking. Replacing them with dbt models means every transformation is tested automatically, the dependency order is inferred from `ref()` calls, and the entire layer rebuilds from one command.

### Key decisions
- **Staging as views, marts as tables** — staging views are cheap and always fresh. Mart tables are pre-computed once at `dbt run` time so the API doesn't re-rank 10,000 institutions on every request.
- **`ref()` over raw table names** — enforces dependency tracking. dbt infers the execution order automatically from these calls.
- **`source()` for raw tables** — distinguishes raw data (owned by ingestion) from models (owned by dbt). Enables freshness checks later.
- **Pin both `dbt-core` and `dbt-postgres`** — leaving pip to resolve versions pulled in `dbt-core 2.0.0a2` which dropped Postgres support. Explicit pinning to `1.8.2` is required.
- **CAGR as a macro** — used in 3 mart models. One place to change the formula if needed.

### Alternatives rejected
- Single large SQL view per dashboard (the traditional BI approach) — works but untestable at intermediate steps and breaks silently when upstream changes
- Python for transformations — dbt in SQL is simpler, faster, and keeps all transformation logic in one layer

### Bugs hit
- `dbt-postgres==1.8.2` pulled in `dbt-core 2.0.0a2` automatically — that version dropped Postgres support. Fixed by pinning `dbt-core==1.8.2` explicitly.
- `ROUND(double precision, int)` doesn't exist in Postgres — `POWER()` returns float, must cast to `::NUMERIC` before `ROUND()`. Fixed in the CAGR macro.
- `HAVING` without `GROUP BY` in `assert_subfield_sums_equal_parent.sql` — should be `WHERE`. Fixed.

### Open questions
- The `tests` key in YAML is deprecated in dbt 1.8 — should be `data_tests`. Works but generates a warning. Will clean up before Phase 6 CI setup.
- Ingestion layer (downloading from NSF website) is still a shortcut — v1's `herd.db` data was copied directly. Proper dlt pipeline replaces this in Phase 5.

### Results
- 8 models built (3 staging views + 5 mart tables)
- 40 tests: 40 pass, 0 fail
- All 3 data invariants confirmed clean across all 10,084 institution/year combinations

---

## [Phase 3] FastAPI (partial) — 2026-07-07

### What was built
- `api/Dockerfile`, `api/requirements.txt` — FastAPI service, containerized
- `api/main.py` — app factory, CORS, lifespan hook (opens/closes the Postgres pool, fits the KNN benchmarker once at startup)
- `api/config.py` — env var loading via pydantic-settings
- `api/db.py` — asyncpg connection pool + `rows_to_dicts()` helper (casts NUMERIC/Decimal columns to float for JSON)
- `api/services/benchmarker.py` — KNN peer-matching, ported from v1 `src/benchmarker.py`; data now loads from Postgres (`stg_institutions`) instead of SQLite
- `api/routers/institutions.py` — list, detail, rank trend, anchor (competitive band), funding breakdown, state rank
- `api/routers/peers.py` — KNN peer IDs, gap analysis, historical peer trend
- `api/routers/portfolio.py` — field portfolio, sub-field drilldown, field momentum (CAGR)
- `api/routers/federal.py` — agency breakdown, trend, HHI concentration score
- `api/routers/qa.py` — natural language Q&A, ported from v1 `src/query_engine.py`'s `ask()`/`generate_sql()`/`summarize_results()` pipeline (Gemini generates SQL → executes read-only → Gemini summarizes)
- `docker-compose.yml` — added `api` service (port 8000, live-mounted code, depends on healthy Postgres)

**Not yet built (deferred by explicit scope decision):** `scenarios`, `projections`, `briefing` routers/services. Institutions/peers/portfolio/federal/qa form the verified foundation; the new decision-engine features will be layered on top of these later.

### Why
Every query the old Streamlit app made directly against SQLite is now an HTTP endpoint, decoupling data access from any particular frontend. This is also the first layer where the Phase 2 dbt investment pays off directly: mart tables already precomputed ranks, CAGRs, and field shares, so most routers are thin `SELECT ... WHERE inst_id = $1` calls instead of re-deriving window functions per request like v1 did.

### Key decisions
- **Routers read from dbt marts, not staging** — `mart_rankings`, `mart_field_portfolio` etc. already have `RANK()`/CAGR precomputed. Only funding breakdown and agency detail (which need raw dollar columns, not just precomputed shares) hit `stg_*` views directly.
- **Benchmarker fitted once at FastAPI startup, stored on `app.state`** — matches CLAUDE.md's "cache reads, never writes" rule. All peer-lookup requests reuse the same fitted KNN model instead of refitting per request (v1 relied on Streamlit's `@st.cache_resource` for the same effect).
- **asyncpg pool built from keyword args, not a DSN string** — same fix as the Phase 1 `load_seed_data.py` bug: the Postgres password contains `@`, which breaks URL-style connection strings. Kept the fix consistent across the codebase.
- **QA schema prompt points at `stg_*` views** — keeps the LLM's SQL flexible (ad hoc questions, not just precomputed marts) while staying consistent with dbt's staging layer naming.
- **CAGR in hand-written/LLM SQL uses the `value * 1.0` trick, not explicit `::FLOAT` casts** — in Postgres, `1.0` is a NUMERIC literal, so `POWER(x * 1.0 / y, ...)` returns NUMERIC and `ROUND()` works directly. The dbt CAGR macro (Phase 2) broke because it explicitly cast to `FLOAT` first; this was avoided here by not doing that.
- **`time.sleep()` swapped for `await asyncio.sleep()`** in the Gemini retry backoff — a blocking call inside an `async def` would freeze the entire event loop, not just one request.
- **QA endpoint returns `503` (not a crash) when `GEMINI_API_KEY` is unset** — the API stays usable for every other router even without an LLM key configured.

### Alternatives rejected
- Recomputing ranks/CAGR in Python inside the API layer (matching v1's approach) — rejected because dbt already computed and materialized these; recomputing would duplicate logic and drift from the tested dbt models.
- Synchronous psycopg2 (matching v1/Phase 1 scripts) — rejected in favor of asyncpg + connection pooling, since FastAPI is async end-to-end and CLAUDE.md requires "no blocking operations in API handlers."
- Building `scenarios`/`projections`/`briefing` alongside the rest of Phase 3 — explicitly deferred at the user's request to keep the phase scoped and verifiable in smaller steps.

### Open questions
- `/qa/ask` has no rate limiting yet (v1 had 50/hour per user) — blocked on an auth layer that doesn't exist yet in v2.
- Gemini API key was copied directly from `nsf-herd-mvp/.env` into `nsf-herd-v2/.env` for convenience — fine for local dev, should be rotated/secured before any real deployment.
- DuckDB (Phase 4) not yet wired in; all analytical queries currently run on Postgres directly, which is fine at current data volume (~300K rows) but scenarios/projections may want DuckDB's speed later.
- `scenarios`, `projections`, `briefing` endpoints remain unbuilt — next planned work.

### Results
- 5 routers live: institutions, peers, portfolio, federal, qa
- Verified against real data: UNT (`inst_id=003594`) rank trend, anchor view, peer gap, field momentum, agency concentration, and two natural-language QA queries (including one with session context) all returned correct results
- `/docs` (Swagger UI) confirmed working

## [Phase 7] Frontend stack reaffirmed — 2026-07-07

### What was built
No new code — a decision checkpoint. Phase 7 (Next.js frontend) was already built and locally verified against all 5 API routers before this checkpoint. Full v1 UI inventory (every widget, chart, and custom-styled element in `app.py`) was catalogued and compared against the new frontend to find visual/feature gaps.

### Why
The frontend was originally started as Next.js/TypeScript without asking which of CLAUDE.md's two Phase 7 options (Reflex vs. React+Next.js) was actually wanted. Once the user pointed out they can't read or write TypeScript, this became a real decision, not just an implementation detail: continuing with a stack the project owner can't maintain independently is a legitimate long-term risk.

### Key decisions
- **Keep Next.js/React**, not Reflex, not "polish v1 Streamlit instead." Reasoning given to the user: the app already works end-to-end, matches CLAUDE.md's "production standard" framing, and has the highest visual/portfolio ceiling.
- **Trade-off accepted explicitly**: the user will not be able to independently maintain this layer without learning TypeScript/React basics. To offset that, `docs/learning.md` now includes a plain-language primer on the exact patterns used in this codebase (not generic React tutorials), so future changes are legible even if written by Claude.
- Clarified a misconception during the discussion: the original reason for choosing a JS frontend was **not** that Streamlit can't support multiple users — v1 already does that via Supabase auth. The actual reason was CLAUDE.md's explicit Phase 7 framing of React as the "production standard" learning goal.

### Alternatives rejected
- **Reflex** — pure Python, would let the user read/edit the frontend directly, but throws away the fully-built and verified Next.js app and is explicitly framed in CLAUDE.md as lower resume value.
- **Drop the frontend rewrite, polish v1 Streamlit instead** — fastest path to a demoable app with zero new language to learn, but abandons the Postgres/dbt/FastAPI backend work already built in Phases 1–3 (v1 still reads from SQLite).

### Open questions
- How much TypeScript/React the user wants to actually learn vs. treat as a black box is still open — `docs/learning.md` primer is a starting point, not a finished curriculum.
- Visual gap-closing work identified in the v1 UI inventory (landing briefing, sidebar, custom peer selection, peer-analysis sub-tabs, state competitive position, chart PNG export, etc.) is not yet scheduled.

### Scope decision — Phase 3 closed as-is (2026-07-07)
Explicit call: institutions, peers, portfolio, federal, and qa cover the full v2 MVP feature set (institutional snapshot, research portfolio, federal landscape, ask-a-question). `scenarios`, `projections`, and `briefing` (CLAUDE.md's Features 1, 3, 4) are **deliberately deferred** — not abandoned, not forgotten. They will be revisited after the frontend makes the current feature set demoable end-to-end. Reasoning: shipping a usable product (API + UI) beats adding more backend surface area no one can see yet. Revisit trigger: once frontend (Phase 7) is live and validated, return to this list before considering the platform "done."

## [Phase 7] Frontend v1-parity build-out — 2026-07-07

### What was built
Three rounds of frontend work bringing the Next.js app to (and past) v1 feature parity:

1. **Institution Snapshot tab** — full rebuild: searchable institution picker, custom peer selector, landing KPIs, LLM strategic insight, rank/anchor bar charts, peer-analysis sub-tabs, funding source analysis. Two bugs fixed: `CustomPeerSelector` was silently capping results at 50 with no indication more existed (removed the `.slice(0, 50)`); the State Competitive Position table showed every in-state institution instead of the top 10 (added `.slice(0, 10)`, retitled the card `Top 10 in {state}`).
2. **Research Portfolio / Federal Landscape tabs** — full rebuild to match v1's exact section order and logic: stacked federal/nonfederal portfolio bars, field-momentum quadrant scatter (median reference lines standing in for Plotly's floating annotations), fastest-growing/largest/most-federal callouts, all-fields sub-field drill-down expanders, portfolio distinctiveness diverging bar. Federal side: donut + table agency breakdown, 3-KPI diversification card, per-agency-colored funding trend line chart, agency growth summary expander, agency distinctiveness diverging bar. Required two new backend endpoints that didn't exist yet: `GET /portfolio/{inst_id}/peer-comparison` and `GET /federal/{inst_id}/peer-comparison`, both following the existing custom-peer-or-KNN resolution pattern from `peers.py`.
3. **Ask tab — dynamic per-institution suggested questions (new, beyond v1 parity)** — v1's suggested questions are static templates (same 9 questions for every school, only the state name swapped in). Built a new rule-based `GET /institutions/{inst_id}/suggested-questions` endpoint that computes real per-institution markers — nearest-ranked peer, top field, fastest-growing field (CAGR > 0), top federal agency, and the field/agency where the institution's peer-relative share is most distinctive (reusing the peer-comparison SQL pattern from the Portfolio/Federal work) — and generates 3 grouped, genuinely different questions per institution. Wired into `QaTab.tsx`, replacing the old static 4-question array.

### Why
The user asked for exact v1 fidelity on Portfolio/Federal, then asked whether the Ask tab could go a step further than v1 and actually reason about the specific institution rather than reusing the same question list for everyone. Since v1 itself doesn't do this, it was treated as new scope rather than a port.

### Key decisions
- **Suggested questions are rule-based SQL, not LLM-generated** — deterministic, no added latency/cost, and the question text is built directly from the same data the rest of the dashboard already shows, so it can't hallucinate a fact the user can't verify on-screen.
- **Reused the peer-comparison pattern three times** (Portfolio, Federal, and now the suggested-questions "distinctiveness" markers) instead of writing three different aggregation strategies — kept as near-identical SQL shapes across `portfolio.py`, `federal.py`, and `institutions.py`.
- **Quadrant labels via `ReferenceLine` + `Label` children** instead of free-floating Plotly-style annotations — Recharts has no direct equivalent; anchoring labels to the median reference lines was the closest approximation and was explicitly flagged as a trade-off.

### Alternatives rejected
- LLM-generated suggested questions (e.g., asking Gemini to look at the institution's data and propose questions) — rejected for latency/cost on every institution switch, and because the rule-based approach already produces concrete, grounded questions with no risk of inventing a fact.

### Bugs hit
- Field names in two of the six suggested-question templates rendered with a raw `", all"` suffix (e.g. "Engineering, all") — the `.replace(", all", "")` cleanup used elsewhere (e.g. the `/insight` endpoint) was missed in the new fastest-field/distinctive-field templates. Fixed.
- The `api` container has no `--reload` and the compose file only live-mounts the code — edits to `.py` files don't take effect until `docker compose restart api`. This was the actual cause of the Portfolio/Federal peer-comparison endpoints appearing to 404 after being "built" in the prior session; they were never actually live until this session's restart. Worth remembering for every future backend change.
- Clicking a suggested peer-comparison question surfaced a pre-existing gap in `/qa/ask`'s NL-to-SQL prompt: Gemini's generated SQL does `name LIKE '%University of Pennsylvania%' LIMIT 1` with no `ORDER BY`, which also matches "East Stroudsburg University of Pennsylvania" etc. and non-deterministically picks the wrong school. Not fixed yet — logged as an open question below.

### Open questions
- `/qa/ask`'s name-matching SQL needs tightening (exact match preferred, `LIKE` as fallback, or resolve peer names to `inst_id` server-side before handing off to Gemini) so peer-comparison questions reliably compare against the right institution.
- Nothing from this session (or the two frontend rebuild rounds before it) is committed to git yet — `api/`, `dbt/`, `docker-compose.yml`, `docs/`, `frontend/`, and `scripts/` are all still untracked. Still just one commit in the repo ("Initial commit: add project document and build plan").
- `scenarios`, `projections`, and `briefing` (CLAUDE.md Features 1, 3, 4) remain deferred, per the Phase 3 scope decision above.

### Results
- Clean `npm run build` (zero TypeScript errors) after each of the three rounds.
- Both new peer-comparison endpoints and the new suggested-questions endpoint verified against live data (Johns Hopkins `029977`, UNT `003594`) after restarting the API container — confirmed genuinely different markers/questions per institution.
