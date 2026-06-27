# NSF HERD v2 — Project Document

> Copy this file into the new `nsf-herd-v2` repo as `CLAUDE.md` before starting any build work.

---

## Project Purpose

Rebuild the NSF HERD Research Intelligence Platform using a modern data engineering stack. The current version (`nsf-herd-mvp`) is a working Streamlit app with raw Python scripts and SQLite. This rebuild serves two goals:

1. **Learn production-grade tools** — Docker, Postgres, dbt, DuckDB, Dagster, FastAPI, React, GitHub Actions
2. **Add decision-engine features** — scenario modeling, peer movement tracking, forward projection, narrative export

The current app tells VPRs where they are. This version tells them where to go.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│                                                              │
│   React (or Reflex as bridge)                                │
│   Charts: Recharts or Plotly React                           │
│   Auth: Supabase Auth (same as v1)                           │
│                                                              │
├──────────────────────┬──────────────────────────────────────-┤
│                      │  HTTP / JSON                          │
├──────────────────────▼──────────────────────────────────────-┤
│                        FASTAPI                               │
│                                                              │
│   /institutions    — list, detail, rank                      │
│   /peers           — KNN matching, gap analysis              │
│   /scenarios       — what-if modeling                        │
│   /projections     — forward trajectory                      │
│   /portfolio       — field analysis                          │
│   /federal         — agency analysis                         │
│   /qa              — natural language queries                │
│   /briefing        — narrative export                        │
│                                                              │
├──────────────────────┬──────────────────────────────────────-┤
│                      │  SQL                                  │
├──────────────────────▼──────────────────────────────────────-┤
│   POSTGRES (OLTP)          │   DUCKDB (OLAP)                │
│   Raw + staging tables     │   Analytical queries            │
│   User preferences         │   Aggregations, CAGRs           │
│   Usage logging             │   Peer comparisons              │
│                             │   Scenario computations         │
├─────────────────────────────┴───────────────────────────────-┤
│                     DAGSTER                                   │
│                                                              │
│   Asset: raw_herd_data     (dlt ingestion)                   │
│   Asset: stg_institutions  (dbt staging)                     │
│   Asset: stg_fields        (dbt staging)                     │
│   Asset: stg_agencies      (dbt staging)                     │
│   Asset: mart_rankings     (dbt mart)                        │
│   Asset: mart_peer_metrics (dbt mart)                        │
│   Asset: mart_field_portfolio (dbt mart)                     │
│   Asset: mart_trajectories (dbt mart)                        │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                   GITHUB ACTIONS                             │
│                                                              │
│   On push: dbt test → dbt build → API health check          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Repo Structure

```
nsf-herd-v2/
├── docker-compose.yml
├── .env.example
├── CLAUDE.md                        ← this file
│
├── ingestion/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── herd_pipeline.py             ← dlt pipeline
│
├── dbt/
│   ├── dbt_project.yml
│   ├── profiles.yml
│   ├── models/
│   │   ├── staging/
│   │   │   ├── _staging.yml         ← schema + tests
│   │   │   ├── stg_institutions.sql
│   │   │   ├── stg_field_expenditures.sql
│   │   │   └── stg_agency_funding.sql
│   │   └── marts/
│   │       ├── _marts.yml           ← schema + tests
│   │       ├── mart_rankings.sql
│   │       ├── mart_peer_metrics.sql
│   │       ├── mart_field_portfolio.sql
│   │       ├── mart_peer_movement.sql
│   │       └── mart_trajectories.sql
│   ├── tests/
│   │   ├── assert_field_totals_equal_total_rd.sql
│   │   ├── assert_agency_sums_equal_federal.sql
│   │   └── assert_subfield_sums_equal_parent.sql
│   ├── macros/
│   │   └── cagr.sql                 ← reusable CAGR macro
│   └── seeds/
│       └── (optional: CSV files for initial load)
│
├── api/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                      ← FastAPI app
│   ├── config.py                    ← env var loading
│   ├── db.py                        ← Postgres + DuckDB connections
│   ├── routers/
│   │   ├── institutions.py
│   │   ├── peers.py
│   │   ├── scenarios.py
│   │   ├── projections.py
│   │   ├── portfolio.py
│   │   ├── federal.py
│   │   ├── qa.py
│   │   └── briefing.py
│   └── services/
│       ├── benchmarker.py           ← KNN logic (ported from v1)
│       ├── scenario_engine.py       ← what-if computations
│       └── narrative.py             ← briefing generation
│
├── orchestration/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── assets.py                    ← Dagster asset definitions
│
├── frontend/                        ← Phase 7 (React or Reflex)
│   └── (scaffold later)
│
├── .github/
│   └── workflows/
│       └── ci.yml                   ← dbt test + API health check
│
└── docs/
    └── decisions.md                 ← architecture decision log
```

---

## What Migrates From v1

| v1 File | v2 Destination | What Changes |
|---|---|---|
| `scripts/etl/1_download.py` | `ingestion/herd_pipeline.py` | Rewritten as dlt pipeline |
| `scripts/etl/2_transform.py` | `dbt/models/staging/stg_institutions.sql` | Python transforms become SQL models |
| `scripts/etl/4_transform_fields.py` | `dbt/models/staging/stg_field_expenditures.sql` | Same |
| `scripts/etl/5_transform_agencies.py` | `dbt/models/staging/stg_agency_funding.sql` | Same |
| `src/query_engine.py` (direct queries) | `api/routers/*.py` | Functions become HTTP endpoints |
| `src/query_engine.py` (NL-to-SQL) | `api/routers/qa.py` | Same logic, served via FastAPI |
| `src/benchmarker.py` | `api/services/benchmarker.py` | Same KNN logic, loaded at API startup |
| `app.py` (auth) | Keep Supabase Auth (same tables) | Frontend calls Supabase directly |
| `app.py` (UI) | `frontend/` | Rebuilt in React or Reflex |
| `data/herd.db` (SQLite) | Postgres tables | Data loaded via dlt + dbt |

---

## New Features (Not in v1)

### Feature 1: Scenario Modeling ("What If" Engine)

**User story**: A VPR slides a bar to add $5M to Engineering. The dashboard instantly shows:
- New national rank (moved from #147 to #132)
- Which peers they'd overtake (Texas State, Utah State)
- New portfolio share breakdown
- New field momentum position

**Implementation**:
- FastAPI endpoint: `POST /scenarios/simulate`
- Input: `{ inst_id, field_code, delta_amount, year }`
- Logic: Take current year data, adjust the field total, recompute rank against all institutions, recompute portfolio share, identify peers overtaken
- Query engine: DuckDB (fast re-ranking of 1,004 institutions)
- No data mutation — all computations are in-memory on top of mart tables

**What you learn**: DuckDB analytical queries, FastAPI request/response design, separation of read vs compute layers.

---

### Feature 2: Peer Movement Tracker

**User story**: A VPR sees an alert card: "Texas State jumped 23 ranks in 3 years. They grew Engineering by 18% CAGR. They're now within $8M of passing you."

**Implementation**:
- dbt mart model: `mart_peer_movement.sql`
  - For each peer: rank change over window, CAGR, dollar gap to target, fields driving growth
  - Flag peers whose rank delta is closing (convergence signal)
- FastAPI endpoint: `GET /peers/{inst_id}/movement?years=5`
- Returns: list of peers sorted by "threat level" (closing gap + high CAGR)

**What you learn**: dbt window functions, mart modeling patterns, analytical SQL.

**dbt model sketch**:
```sql
WITH peer_ranks AS (
    SELECT
        inst_id,
        year,
        total_rd,
        RANK() OVER (PARTITION BY year ORDER BY total_rd DESC) AS national_rank
    FROM {{ ref('stg_institutions') }}
),
rank_changes AS (
    SELECT
        inst_id,
        MAX(CASE WHEN year = {{ var('end_year') }} THEN national_rank END)
          - MAX(CASE WHEN year = {{ var('start_year') }} THEN national_rank END) AS rank_delta,
        -- negative delta = improved (rank number decreased)
        ...
    FROM peer_ranks
    GROUP BY inst_id
)
```

---

### Feature 3: Forward Projection ("At This Rate")

**User story**: A VPR sees a chart with a dashed line extending 3 years into the future. "At current growth rates, Texas State will overtake you in total R&D by FY2027."

**Implementation**:
- dbt mart model: `mart_trajectories.sql`
  - Compute CAGR for each institution over selected window
  - Project total_rd forward 1, 2, 3 years using CAGR
  - Identify crossover points (year when a peer's projected total_rd exceeds yours)
- FastAPI endpoint: `GET /projections/{inst_id}?years_forward=3`
- Returns: projected values + crossover alerts

**What you learn**: Time series projection in SQL, dbt model layering (staging → mart → projection).

**Important**: Always label projections as "At current growth rates" — these are trajectories, not predictions. VPRs understand the difference.

---

### Feature 4: Narrative Export (Provost-Ready Briefing)

**User story**: A VPR clicks "Generate Briefing" and gets a 1-page document they can forward to their provost:

> **Research Positioning Brief — University of North Texas**
> FY2024 | Prepared for Office of the VPR
>
> UNT ranks #147 nationally in total R&D ($178M), up 12 positions over 5 years.
> Growth of 8.2% CAGR outpaces our 10 benchmark peers (avg 5.1%).
> However, Texas State has closed the gap from $42M behind to $8M and is
> projected to overtake us by FY2027 at current rates.
>
> Recommended focus: Engineering (+$5M investment would move us to #132
> and overtake 3 peers).

**Implementation**:
- FastAPI endpoint: `POST /briefing/generate`
- Pulls data from mart models (rank, peers, projections, scenarios)
- LLM generates executive narrative from structured data points
- Returns: JSON with sections (can render as HTML, PDF, or React component)
- Library for PDF: `fpdf2` (lightweight, no browser dependencies)

**What you learn**: LLM prompt engineering for structured output, document generation, API design for complex responses.

---

## Deferred Features (Do Not Build Yet)

### Multi-Source Enrichment (IPEDS + Federal Radar)
- **IPEDS**: Faculty counts, enrollment, Carnegie classification → R&D per faculty metric
- **Federal Radar**: The separate project pulling grants from NSF, NIH, USAspending.gov
- **Plan**: Build a centralized data platform later that connects Federal Radar + HERD v2 + IPEDS
- **When**: After the core v2 is deployed and the tech stack is solid
- **Note**: This is where dlt + Dagster truly shine — pulling from 3+ APIs into one warehouse. Save it for when you can appreciate why orchestration matters.

### R&D Per Faculty (Depends on IPEDS)
- Blocked by IPEDS integration
- Once IPEDS faculty data is in Postgres, this is a single dbt model join
- Deferred with IPEDS above

---

## Build Phases

### Phase 1: Docker + Postgres (Foundation)

**Goal**: One command (`docker compose up`) gives you a running Postgres with the HERD schema.

**Files to create**:
- `docker-compose.yml` — Postgres service with persistent volume
- `.env.example` — template for env vars
- `scripts/seed.sql` — CREATE TABLE statements for all 3 tables
- `scripts/load_seed_data.py` — Python script to copy data from `herd.db` (SQLite) into Postgres

**What you learn**:
- Docker containers, volumes, networks
- Postgres basics (psql, CREATE TABLE, COPY)
- Environment variables in Docker
- The difference between SQLite (file) and Postgres (server)

**Verify it works**:
```bash
docker compose up -d
docker compose exec postgres psql -U herd -d herd_db -c "SELECT COUNT(*) FROM institutions;"
# Should return 10084
```

**Key decisions**:
- Postgres user: `herd`, database: `herd_db`
- Port: 5432 (standard)
- Volume: `pgdata` (persists data between restarts)
- No Neon for local dev — use containerized Postgres (zero cold starts, no 0.5GB limit)

---

### Phase 2: dbt Core (Transformation + Tests)

**Goal**: Replace the 6 Python ETL scripts with SQL models that are tested and documented.

**Files to create**:
- `dbt/dbt_project.yml` — project config
- `dbt/profiles.yml` — Postgres connection (reads from env vars)
- `dbt/models/staging/stg_institutions.sql` — clean raw data
- `dbt/models/staging/stg_field_expenditures.sql`
- `dbt/models/staging/stg_agency_funding.sql`
- `dbt/models/staging/_staging.yml` — column descriptions + tests
- `dbt/models/marts/mart_rankings.sql` — precomputed national ranks per year
- `dbt/models/marts/mart_peer_metrics.sql` — CAGR, growth rank, gap analysis
- `dbt/models/marts/mart_field_portfolio.sql` — field shares, momentum data
- `dbt/models/marts/mart_peer_movement.sql` — peer convergence tracking (Feature 2)
- `dbt/models/marts/mart_trajectories.sql` — forward projections (Feature 3)
- `dbt/models/marts/_marts.yml` — schema + tests
- `dbt/tests/assert_field_totals_equal_total_rd.sql` — invariant test
- `dbt/tests/assert_agency_sums_equal_federal.sql` — invariant test
- `dbt/tests/assert_subfield_sums_equal_parent.sql` — invariant test
- `dbt/macros/cagr.sql` — reusable CAGR computation

**What you learn**:
- dbt model types (staging vs marts)
- dbt tests (generic: not_null, unique, accepted_values; singular: custom SQL assertions)
- dbt documentation (YAML schema files)
- ref() for model dependencies (automatic DAG)
- Jinja templating in SQL
- The staging → mart pattern (ELT, not ETL)

**Verify it works**:
```bash
cd dbt
dbt run        # builds all models
dbt test       # runs all tests (should be 0 failures)
dbt docs generate && dbt docs serve  # visual DAG + docs
```

**Critical tests (must pass)**:
1. `SUM(field_expenditures.total WHERE is_parent=1) = institutions.total_rd` per inst_id/year
2. `SUM(agency_funding.amount) = institutions.federal` per inst_id/year
3. For each parent field with sub-fields: `parent.total = SUM(sub_field.total)`
4. `total_rd = federal + state_local + business + nonprofit + institutional + other_sources`
5. No null `inst_id` or `year` in any table
6. Year range: 2010–2024 only

**dbt modeling rules**:
- Staging models are 1:1 with source tables. Clean column names, cast types, handle nulls.
- Mart models are business logic. Join tables, compute metrics, pre-aggregate.
- Never modify source data in staging — only rename, cast, filter.
- Every mart model must have at least one test.
- Use `{{ ref('stg_institutions') }}` never raw table names in mart models.

---

### Phase 3: FastAPI (API Layer)

**Goal**: Every query the Streamlit app makes is now an HTTP endpoint.

**Files to create**:
- `api/Dockerfile`
- `api/requirements.txt`
- `api/main.py` — FastAPI app with CORS, startup events
- `api/config.py` — env var loading (DATABASE_URL, GEMINI_API_KEY, etc.)
- `api/db.py` — Postgres connection pool + DuckDB connection
- `api/routers/institutions.py` — list, detail, rank trend, anchor view
- `api/routers/peers.py` — KNN peers, gap analysis, peer trend
- `api/routers/portfolio.py` — field breakdown, momentum, drilldown, distinctiveness
- `api/routers/federal.py` — agency breakdown, trends, concentration, distinctiveness
- `api/routers/scenarios.py` — what-if simulation (Feature 1)
- `api/routers/projections.py` — forward trajectory (Feature 3)
- `api/routers/qa.py` — natural language Q&A (port from v1)
- `api/routers/briefing.py` — narrative export (Feature 4)
- `api/services/benchmarker.py` — KNN logic (port from v1 `src/benchmarker.py`)
- `api/services/scenario_engine.py` — what-if computation logic
- `api/services/narrative.py` — LLM-based briefing generation

**What you learn**:
- FastAPI routing, request/response models (Pydantic)
- Dependency injection (database connections)
- Async Python (async def endpoints)
- API documentation (auto-generated OpenAPI/Swagger at /docs)
- Connection pooling (asyncpg or psycopg pool)
- Separation of concerns (router → service → database)

**Verify it works**:
```bash
# In docker-compose, api service runs on port 8000
curl http://localhost:8000/institutions?limit=5
curl http://localhost:8000/peers/003594          # UNT's peers
curl http://localhost:8000/docs                  # Swagger UI
```

**Porting guide from v1**:
| v1 method | v2 endpoint |
|---|---|
| `engine.get_institution_list()` | `GET /institutions` |
| `engine.get_rank_trend(name, start, end)` | `GET /institutions/{inst_id}/rank?start=2019&end=2024` |
| `engine.get_anchor_view(name, year)` | `GET /institutions/{inst_id}/anchor?year=2024` |
| `engine.get_funding_breakdown(name, start, end)` | `GET /institutions/{inst_id}/funding?start=2019&end=2024` |
| `engine.get_state_ranking(name, year, start)` | `GET /institutions/{inst_id}/state-rank?year=2024` |
| `engine.get_field_portfolio(name, year)` | `GET /portfolio/{inst_id}?year=2024` |
| `engine.get_field_momentum(name, start, end)` | `GET /portfolio/{inst_id}/momentum?start=2019&end=2024` |
| `engine.get_agency_breakdown(name, year)` | `GET /federal/{inst_id}?year=2024` |
| `engine.get_agency_concentration(name, year)` | `GET /federal/{inst_id}/concentration?year=2024` |
| `benchmarker.get_peer_inst_ids(inst_id)` | `GET /peers/{inst_id}` |
| `benchmarker.analyze_gap(inst_id)` | `GET /peers/{inst_id}/gap` |
| `benchmarker.get_peer_trend(inst_id, ...)` | `GET /peers/{inst_id}/trend?start=2019&end=2024` |
| `engine.ask(question, context)` | `POST /qa/ask` |
| (new) | `POST /scenarios/simulate` |
| (new) | `GET /projections/{inst_id}` |
| (new) | `POST /briefing/generate` |

**API design rules**:
- All endpoints return JSON. No HTML, no Streamlit widgets.
- Use Pydantic models for request/response validation.
- inst_id is the primary key — never accept institution name as a path parameter.
- All dollar amounts returned as integers (cents or dollars, consistent).
- Errors return proper HTTP status codes (404 for unknown inst_id, 422 for bad params).
- Rate limiting on /qa/ask (50/hour per user, same as v1).

---

### Phase 4: DuckDB (Analytical Layer)

**Goal**: Heavy analytical queries (peer comparisons, CAGR computations, scenario simulations) run on DuckDB for speed.

**Implementation**:
- DuckDB connects to Postgres via `postgres_scanner` extension (reads Postgres tables directly)
- Or: DuckDB reads from Parquet files exported by dbt
- Scenario modeling queries run entirely in DuckDB (re-ranking 1,004 institutions in memory)

**Files to create/modify**:
- `api/db.py` — add DuckDB connection alongside Postgres
- `api/routers/scenarios.py` — uses DuckDB for fast re-ranking
- `api/routers/projections.py` — uses DuckDB for CAGR extrapolation

**What you learn**:
- DuckDB embedded analytics (no server, in-process)
- When to use OLTP (Postgres: row lookups, user data) vs OLAP (DuckDB: aggregations, analytics)
- Cross-database queries (DuckDB reading from Postgres)

**Verify it works**:
```python
import duckdb
conn = duckdb.connect()
conn.execute("INSTALL postgres; LOAD postgres;")
conn.execute("ATTACH 'dbname=herd_db user=herd host=localhost' AS pg (TYPE POSTGRES)")
result = conn.execute("SELECT COUNT(*) FROM pg.institutions").fetchone()
# Should return (10084,)
```

---

### Phase 5: Dagster (Orchestration)

**Goal**: One command runs the entire pipeline — ingestion, dbt build, dbt test — with lineage and observability.

**Files to create**:
- `orchestration/Dockerfile`
- `orchestration/requirements.txt`
- `orchestration/assets.py` — Dagster asset definitions
- Update `docker-compose.yml` — add Dagster webserver + daemon services

**Asset definitions**:
```python
# Each dbt model becomes a Dagster asset automatically
from dagster_dbt import DbtCliResource, dbt_assets

@dbt_assets(manifest=dbt_manifest_path)
def herd_dbt_assets(context, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()
```

**What you learn**:
- Asset-based orchestration (vs task-based like Airflow)
- Dagster + dbt integration (dbt models as Dagster assets)
- Lineage visualization (Dagster UI shows the full DAG)
- Sensors and schedules (trigger pipeline on new data file)
- Partitions (optional: partition by year for incremental loads)

**Verify it works**:
- Open Dagster UI at `http://localhost:3000`
- See all dbt models as assets with lineage
- Trigger a materialization — all assets build in order
- Green checkmarks on all dbt tests

---

### Phase 6: GitHub Actions (CI/CD)

**Goal**: Every push runs dbt tests. A green badge proves the data pipeline is healthy.

**Files to create**:
- `.github/workflows/ci.yml`

**Pipeline steps**:
1. Spin up Postgres service (GitHub Actions service container)
2. Load seed data
3. `dbt deps` → `dbt run` → `dbt test`
4. Run FastAPI health check
5. Badge: passing/failing

**What you learn**:
- GitHub Actions workflow syntax
- Service containers (Postgres in CI)
- CI for data pipelines (not just application code)
- Build badges (credibility signal in portfolio repos)

**Verify it works**:
- Push to GitHub → Actions tab shows green workflow
- Add badge to README: `![CI](https://github.com/youruser/nsf-herd-v2/actions/workflows/ci.yml/badge.svg)`

---

### Phase 7: Frontend (React or Reflex)

**Goal**: Replace Streamlit with a modern frontend that calls the FastAPI backend.

**Two options**:

**Option A: Reflex (Python bridge — learn React patterns without JavaScript)**
- Write in Python, compiles to React
- Good stepping stone if JavaScript is new
- Less impressive on resume than pure React but teaches the right mental models

**Option B: React + Next.js (production standard)**
- TypeScript, component model, state management
- Recharts or Plotly React for charts
- Supabase Auth SDK for login
- Deploy to Vercel

**What you learn**:
- Component-based UI architecture
- Frontend/backend separation
- API consumption from a browser
- State management (React hooks or Zustand)
- Responsive design (CSS, Tailwind)

**Build order within this phase**:
1. Institution picker + KPI cards (simplest — one API call, render data)
2. Peer comparison charts (Recharts bar chart from /peers/{id}/gap)
3. Scenario slider (interactive — POST to /scenarios/simulate, re-render)
4. Q&A chat interface (most complex — streaming, history, code blocks)

---

## Engineering Principles (Carry From v1)

These rules apply to every phase:

- **Join on inst_id, never name** — 259 institutions changed names across 15 years
- **Never mutate source data** — staging models clean, mart models transform
- **Field totals must equal total_rd** — test this in dbt, test this in CI
- **Agency sums must equal federal** — same
- **Positioning not judgment** — never use HIGH/MODERATE/LOW risk labels
- **Cache reads, never writes** — benchmarker is fitted once at API startup
- **Supabase calls are fire-and-forget** — logging never crashes the app
- **inst_id is the primary key** — API endpoints take inst_id, not name
- **No blocking operations in API handlers** — use async where possible

---

## Data Invariants (Must Pass in Every Environment)

These are non-negotiable. If any fails, the pipeline is broken.

```sql
-- 1. Field totals equal total_rd
SELECT inst_id, year
FROM stg_institutions i
WHERE total_rd != (
    SELECT COALESCE(SUM(total), 0)
    FROM stg_field_expenditures f
    WHERE f.inst_id = i.inst_id AND f.year = i.year AND f.is_parent = 1
);
-- Must return 0 rows

-- 2. Agency sums equal federal
SELECT inst_id, year
FROM stg_institutions i
WHERE federal != (
    SELECT COALESCE(SUM(amount), 0)
    FROM stg_agency_funding a
    WHERE a.inst_id = i.inst_id AND a.year = i.year
);
-- Must return 0 rows

-- 3. Sub-field sums equal parent
SELECT f.inst_id, f.year, f.field_code
FROM stg_field_expenditures f
WHERE f.is_parent = 1
AND f.total != (
    SELECT COALESCE(SUM(s.total), 0)
    FROM stg_field_expenditures s
    WHERE s.parent_field = f.field_code
    AND s.inst_id = f.inst_id AND s.year = f.year AND s.is_parent = 0
)
AND f.field_code IN ('engineering', 'life_sciences', 'physical_sciences',
                     'social_sciences', 'non_se', 'geosciences');
-- Must return 0 rows (excludes standalone parents: cs, math, psychology, other_sciences)

-- 4. Funding sources sum to total
SELECT inst_id, year
FROM stg_institutions
WHERE total_rd != federal + state_local + business + nonprofit + institutional + other_sources;
-- Must return 0 rows
```

---

## Database Schema (Postgres — matches v1 SQLite)

```sql
CREATE TABLE raw_institutions (
    inst_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    city          TEXT,
    state         TEXT NOT NULL,
    year          INTEGER NOT NULL,
    total_rd      BIGINT,
    federal       BIGINT,
    state_local   BIGINT,
    business      BIGINT,
    nonprofit     BIGINT,
    institutional BIGINT,
    other_sources BIGINT,
    PRIMARY KEY (inst_id, year)
);

CREATE TABLE raw_field_expenditures (
    inst_id      TEXT NOT NULL,
    year         INTEGER NOT NULL,
    field_code   TEXT NOT NULL,
    parent_field TEXT,
    is_parent    INTEGER NOT NULL,
    field_name   TEXT,
    federal      BIGINT,
    nonfederal   BIGINT,
    total        BIGINT,
    PRIMARY KEY (inst_id, year, field_code)
);

CREATE TABLE raw_agency_funding (
    inst_id     TEXT NOT NULL,
    year        INTEGER NOT NULL,
    agency_code TEXT NOT NULL,
    agency_name TEXT,
    amount      BIGINT,
    PRIMARY KEY (inst_id, year, agency_code)
);
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | Yes | `herd` | Postgres username |
| `POSTGRES_PASSWORD` | Yes | — | Postgres password |
| `POSTGRES_DB` | Yes | `herd_db` | Postgres database name |
| `POSTGRES_HOST` | Yes | `localhost` | Postgres host (use service name in Docker) |
| `POSTGRES_PORT` | No | `5432` | Postgres port |
| `DATABASE_URL` | Auto | — | Constructed from above: `postgresql://user:pass@host:port/db` |
| `GEMINI_API_KEY` | Yes | — | For Q&A + narrative generation |
| `SUPABASE_URL` | Yes | — | Auth + usage logging (same as v1) |
| `SUPABASE_ANON_KEY` | Yes | — | Supabase anon key (same as v1) |

---

## Deferred: Federal Radar Integration

The separate Federal Radar project pulls active grant data from NSF, NIH, and USAspending.gov.

**Future plan**: Build a centralized data platform that connects:
1. NSF HERD v2 (this project — historical R&D expenditures)
2. Federal Radar (active grants and awards)
3. IPEDS (faculty counts, enrollment, Carnegie classification)

**Architecture when integrated**:
- Shared Postgres warehouse with separate schemas: `herd`, `federal_radar`, `ipeds`
- dbt models that join across schemas (R&D per faculty, grant pipeline vs historical spend)
- Dagster orchestrates all three pipelines with cross-asset dependencies
- One FastAPI serves unified endpoints

**Do not build this now.** Get the core v2 working first. The tech stack (dlt, Dagster, dbt) is intentionally chosen to make this integration straightforward when the time comes.

---

## Process Rules

- **New repo**: `nsf-herd-v2`. Never modify `nsf-herd-mvp`.
- **One phase at a time**: Do not start Phase N+1 until Phase N is verified.
- **Verify before moving on**: Each phase has a "Verify it works" section. Run it.
- **Commit after each working step**: Small commits, clear messages.
- **Document decisions**: When you make an architectural choice, add it to `docs/decisions.md`.
- **No Claude co-author**: Do not include `Co-Authored-By: Claude` in commit messages.
- **Ask one clarifying question max**: Then proceed.
- **Understand before moving on**: After Claude generates code, read every line. If you can't explain it, ask Claude to explain before proceeding.

---

## How to Start

1. Create the repo: `mkdir nsf-herd-v2 && cd nsf-herd-v2 && git init`
2. Copy this file as `CLAUDE.md`
3. Tell Claude Code: "Start Phase 1. Create docker-compose.yml with Postgres."
4. Follow the verify steps
5. When green, tell Claude Code: "Phase 1 verified. Start Phase 2."

Each phase builds on the previous. The document tells Claude Code exactly what to build, in what order, with what constraints.
