# NSF HERD v2 — Research Intelligence Platform

A rebuild of the NSF HERD Research Intelligence Platform (originally a Streamlit + SQLite MVP) on a production-grade data stack: Postgres, dbt, FastAPI, and Next.js. It helps university Vice Presidents for Research (VPRs) benchmark their institution's R&D spending against peers, track portfolio composition by field and federal agency, and answer natural-language questions about the data.

The MVP told VPRs where they are. This version is being built toward telling them where to go — scenario modeling, peer movement tracking, and forward projection are planned next.

## Status

| Phase | Status |
|---|---|
| 1. Docker + Postgres | Done |
| 2. dbt Core (staging + marts + tests) | Done |
| 3. FastAPI (institutions, peers, portfolio, federal, qa) | Partial — scenarios/projections/briefing deferred |
| 4. DuckDB analytical layer | Not started |
| 5. Dagster orchestration | Not started |
| 6. GitHub Actions CI | Not started |
| 7. Frontend (Next.js) | Done — full MVP feature parity |

See [`CLAUDE.md`](./CLAUDE.md) for the full build plan and [`docs/decisions.md`](./docs/decisions.md) for the architecture decision log.

## Stack

- **Postgres** — raw + staging tables (OLTP)
- **dbt** — staging/mart transformation layer, with data invariant tests
- **FastAPI** — HTTP API serving mart data, KNN peer matching, and LLM-backed Q&A
- **Next.js / React** — frontend
- **Docker Compose** — local orchestration of all services

## Getting Started

```bash
# 1. Copy env template and fill in values (Postgres password, Gemini API key, Supabase creds)
cp .env.example .env

# 2. Start Postgres
docker compose up -d postgres

# 3. Load seed data (from v1's SQLite export)
python scripts/load_seed_data.py

# 4. Build dbt models
docker compose run --rm dbt run
docker compose run --rm dbt test

# 5. Start the API
docker compose up -d api
curl http://localhost:8000/docs   # Swagger UI

# 6. Start the frontend
cd frontend
npm install
npm run dev                        # http://localhost:3000
```

## Repo Structure

```
nsf-herd-v2/
├── docker-compose.yml
├── scripts/           # seed SQL + SQLite -> Postgres migration
├── dbt/                # staging + mart models, tests, macros
├── api/                # FastAPI app (routers, services)
├── frontend/           # Next.js app
└── docs/
    └── decisions.md    # architecture decision log
```

## Engineering Principles

- Join on `inst_id`, never institution name (259 institutions changed names across 15 years)
- Never mutate source data — staging models clean, mart models transform
- Field totals must equal `total_rd`; agency sums must equal `federal` (enforced by dbt tests)
- Positioning, not judgment — no HIGH/MODERATE/LOW risk labels
- Projections are always labeled "at current growth rates," never presented as predictions

See [`CLAUDE.md`](./CLAUDE.md) for the complete set of process rules and data invariants.
