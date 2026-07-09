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
