-- NSF HERD v2 — Raw table schema
-- Runs automatically on first `docker compose up` via initdb.d

CREATE TABLE IF NOT EXISTS raw_institutions (
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

CREATE TABLE IF NOT EXISTS raw_field_expenditures (
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

CREATE TABLE IF NOT EXISTS raw_agency_funding (
    inst_id     TEXT NOT NULL,
    year        INTEGER NOT NULL,
    agency_code TEXT NOT NULL,
    agency_name TEXT,
    amount      BIGINT,
    PRIMARY KEY (inst_id, year, agency_code)
);

CREATE TABLE IF NOT EXISTS raw_institution_classifications (
    inst_id         TEXT NOT NULL PRIMARY KEY,
    unitid          TEXT,
    carnegie_class  TEXT,
    control         TEXT,
    has_med_school  BOOLEAN,
    is_aau          BOOLEAN DEFAULT FALSE,
    is_aplu         BOOLEAN DEFAULT FALSE,
    is_hbcu         BOOLEAN DEFAULT FALSE,
    is_hsi          BOOLEAN DEFAULT FALSE,
    is_epscor       BOOLEAN DEFAULT FALSE,
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- Tracks which HERD survey years have been loaded and when. Nothing wrote
-- to this before it existed -- the 2010-2024 data already in the raw_*
-- tables was copied once from v1's SQLite file, not through any tracked
-- pipeline (see docs/decisions.md "[Phase 1]"). Backfilled below with
-- loaded_at left NULL rather than a fabricated date. The ingestion
-- pipeline (ingestion/) writes a new row here after each successful load.
CREATE TABLE IF NOT EXISTS data_loads (
    year        INTEGER PRIMARY KEY,
    loaded_at   TIMESTAMPTZ,
    source      TEXT NOT NULL,
    row_counts  JSONB,
    notes       TEXT
);

INSERT INTO data_loads (year, loaded_at, source, row_counts)
SELECT
    y.year,
    NULL,
    'v1 migration (pre-tracking)',
    jsonb_build_object(
        'raw_institutions', (SELECT COUNT(*) FROM raw_institutions WHERE year = y.year),
        'raw_field_expenditures', (SELECT COUNT(*) FROM raw_field_expenditures WHERE year = y.year),
        'raw_agency_funding', (SELECT COUNT(*) FROM raw_agency_funding WHERE year = y.year)
    )
FROM (SELECT DISTINCT year FROM raw_institutions) y
ON CONFLICT (year) DO NOTHING;
