"""
Loads transformed DataFrames into this app's Postgres and records the run
in `data_loads`.

Each table load is a full delete+insert for that (table, year) pair, all
inside one transaction across all three tables plus the data_loads write.
Re-running for a year that's already loaded cleanly replaces it -- no
duplicate rows, no partial year ever left in place if something fails
partway through (the whole transaction rolls back).
"""

import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extensions import AsIs, register_adapter
from psycopg2.extras import execute_values

# psycopg2 doesn't know how to adapt numpy scalar types by default, and
# every integer column in these DataFrames ends up numpy-backed (int64)
# once pandas builds the table, regardless of the Python types used to
# construct it.
register_adapter(np.int64, lambda val: AsIs(val))
register_adapter(np.float64, lambda val: AsIs(val))


def get_connection():
    return psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "postgres"),
        port=int(os.environ.get("POSTGRES_PORT", 5432)),
        user=os.environ.get("POSTGRES_USER", "herd"),
        password=os.environ["POSTGRES_PASSWORD"],
        dbname=os.environ.get("POSTGRES_DB", "herd_db"),
    )


def _replace_year(conn, table: str, year: int, df: pd.DataFrame) -> int:
    columns = list(df.columns)
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {table} WHERE year = %s", (year,))
        if not df.empty:
            values = [tuple(row) for row in df.itertuples(index=False, name=None)]
            execute_values(cur, f"INSERT INTO {table} ({', '.join(columns)}) VALUES %s", values)
    return len(df)


def load_year(
    year: int,
    institutions: pd.DataFrame,
    field_expenditures: pd.DataFrame,
    agency_funding: pd.DataFrame,
) -> dict:
    """Load all three tables for one year, then record the run in
    data_loads -- all in a single transaction. Raises and rolls back the
    whole thing on any failure, so a bad load never leaves a half-written
    year in the database."""
    conn = get_connection()
    try:
        row_counts = {
            "raw_institutions": _replace_year(conn, "raw_institutions", year, institutions),
            "raw_field_expenditures": _replace_year(conn, "raw_field_expenditures", year, field_expenditures),
            "raw_agency_funding": _replace_year(conn, "raw_agency_funding", year, agency_funding),
        }

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO data_loads (year, loaded_at, source, row_counts)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (year) DO UPDATE SET
                    loaded_at = EXCLUDED.loaded_at,
                    source = EXCLUDED.source,
                    row_counts = EXCLUDED.row_counts
                """,
                (year, datetime.now(timezone.utc), "ingestion pipeline", json.dumps(row_counts)),
            )

        conn.commit()
        return row_counts
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
