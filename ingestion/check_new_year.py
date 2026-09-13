"""
Read-only check: does NSF currently publish a HERD survey year that isn't
loaded yet? Never touches the database with a write, never downloads
anything -- safe to run anytime, including on a schedule, unlike the
actual pipeline (see docs/decisions.md "[Data Pipeline] Ingestion
pipeline" for why the load itself stays manual).

    docker compose run ingestion python check_new_year.py
"""

import os

import psycopg2

from download import discover_years


def latest_loaded_year() -> int | None:
    conn = psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "postgres"),
        port=int(os.environ.get("POSTGRES_PORT", 5432)),
        user=os.environ.get("POSTGRES_USER", "herd"),
        password=os.environ["POSTGRES_PASSWORD"],
        dbname=os.environ.get("POSTGRES_DB", "herd_db"),
    )
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(year) FROM data_loads")
            return cur.fetchone()[0]
    finally:
        conn.close()


if __name__ == "__main__":
    print("Checking NSF's HERD microdata page for available years...")
    available = sorted(discover_years(min_year=2010))
    print(f"NSF currently publishes: {available}")

    loaded = latest_loaded_year()
    print(f"Latest year loaded in this database: {loaded}")

    new_years = [y for y in available if loaded is None or y > loaded]
    if new_years:
        print(f"\nNew year(s) available: {new_years}")
        print(f"Run: docker compose run ingestion python pipeline.py --year {new_years[0]}")
    else:
        print("\nUp to date -- nothing new to load.")
