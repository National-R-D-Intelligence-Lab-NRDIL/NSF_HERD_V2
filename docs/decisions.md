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

