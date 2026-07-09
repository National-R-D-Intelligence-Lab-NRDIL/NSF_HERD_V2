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
