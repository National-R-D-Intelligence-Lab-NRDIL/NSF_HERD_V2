"""
Load data from the v1 SQLite database (herd.db) into Postgres.

Usage:
    python scripts/load_seed_data.py --sqlite path/to/herd.db

Requires:
    pip install psycopg2-binary python-dotenv
"""

import argparse
import os
import sqlite3

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

BATCH_SIZE = 1000

PG_CONNECT_ARGS = dict(
    host=os.environ.get("POSTGRES_HOST", "localhost"),
    port=int(os.environ.get("POSTGRES_PORT", "5432")),
    user=os.environ["POSTGRES_USER"],
    password=os.environ["POSTGRES_PASSWORD"],
    dbname=os.environ["POSTGRES_DB"],
)

TABLE_MAP = {
    "raw_institutions": {
        "source": "institutions",
        "columns": [
            "inst_id", "name", "city", "state", "year",
            "total_rd", "federal", "state_local", "business",
            "nonprofit", "institutional", "other_sources",
        ],
    },
    "raw_field_expenditures": {
        "source": "field_expenditures",
        "columns": [
            "inst_id", "year", "field_code", "parent_field", "is_parent",
            "field_name", "federal", "nonfederal", "total",
        ],
    },
    "raw_agency_funding": {
        "source": "agency_funding",
        "columns": ["inst_id", "year", "agency_code", "agency_name", "amount"],
    },
}


def load_table(sqlite_conn, pg_conn, target_table: str, config: dict) -> int:
    source_table = config["source"]
    columns = config["columns"]
    col_list = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))

    cur_sqlite = sqlite_conn.cursor()
    cur_sqlite.execute(f"SELECT {col_list} FROM {source_table}")

    cur_pg = pg_conn.cursor()
    total = 0

    while True:
        rows = cur_sqlite.fetchmany(BATCH_SIZE)
        if not rows:
            break
        psycopg2.extras.execute_values(
            cur_pg,
            f"INSERT INTO {target_table} ({col_list}) VALUES %s ON CONFLICT DO NOTHING",
            rows,
        )
        total += len(rows)
        print(f"  {target_table}: {total} rows loaded", end="\r")

    pg_conn.commit()
    print(f"  {target_table}: {total} rows loaded")
    return total


def main():
    parser = argparse.ArgumentParser(description="Load HERD SQLite data into Postgres")
    parser.add_argument(
        "--sqlite",
        default=os.path.join(os.path.dirname(__file__), "..", "..", "nsf-herd-mvp", "data", "herd.db"),
        help="Path to herd.db SQLite file",
    )
    args = parser.parse_args()

    print(f"Source: {args.sqlite}")
    print(f"Target: {PG_CONNECT_ARGS['host']}:{PG_CONNECT_ARGS['port']}/{PG_CONNECT_ARGS['dbname']}")

    sqlite_conn = sqlite3.connect(args.sqlite)
    pg_conn = psycopg2.connect(**PG_CONNECT_ARGS)

    try:
        for target_table, config in TABLE_MAP.items():
            load_table(sqlite_conn, pg_conn, target_table, config)
    finally:
        sqlite_conn.close()
        pg_conn.close()

    print("Done.")


if __name__ == "__main__":
    main()
