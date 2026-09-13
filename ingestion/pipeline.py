"""
NSF HERD ingestion pipeline -- run manually, once a year, whenever NSF
publishes a new survey year:

    docker compose run ingestion python pipeline.py --year 2025

Downloads that year's microdata from NSF, transforms it into the three
tables this app's Postgres schema expects, validates it against the same
data invariants dbt tests enforce (see CLAUDE.md "Data Invariants"), and
only then loads it -- a failed validation means nothing gets written.

Not automated on a schedule: see docs/decisions.md "[Data Pipeline]
Ingestion pipeline" for why NSF's low, unpredictable publish cadence makes
an unattended cron job riskier than useful here.
"""

import argparse
import sys
from pathlib import Path

import pandas as pd

from download import download_year
from load import load_year
from transform import transform_agency_funding, transform_field_expenditures, transform_institutions

RAW_DIR = Path(__file__).parent / "data" / "raw"

# Parents with no sub-fields in the survey -- excluded from the
# parent-equals-sum-of-subfields check, same exclusion dbt's own test uses.
STANDALONE_PARENTS = {"cs", "math", "psychology", "other_sciences"}


def validate(institutions: pd.DataFrame, fields: pd.DataFrame, agencies: pd.DataFrame, year: int) -> None:
    """Raises ValueError on the first invariant violation found. Mirrors
    the dbt tests in CLAUDE.md's "Data Invariants" section -- checked here
    too so a bad transform is caught before it ever reaches the database,
    not just at the next `dbt test` run."""

    # 1. total_rd = federal + state_local + business + nonprofit + institutional + other_sources
    funding_sum = (
        institutions["federal"] + institutions["state_local"] + institutions["business"]
        + institutions["nonprofit"] + institutions["institutional"] + institutions["other_sources"]
    )
    mismatched = institutions[institutions["total_rd"] != funding_sum]
    if not mismatched.empty:
        raise ValueError(
            f"{year}: {len(mismatched)} institution(s) where total_rd != sum of funding sources "
            f"(e.g. inst_id {mismatched.iloc[0]['inst_id']})"
        )

    # 2. Agency sums should equal institutions.federal, per institution
    agency_totals = agencies.groupby("inst_id")["amount"].sum()
    inst_federal = institutions.set_index("inst_id")["federal"]
    joined = pd.concat([inst_federal, agency_totals.rename("agency_total")], axis=1).fillna(0)
    mismatched = joined[joined["federal"] != joined["agency_total"]]
    if not mismatched.empty:
        raise ValueError(
            f"{year}: {len(mismatched)} institution(s) where agency funding sum != institutions.federal "
            f"(e.g. inst_id {mismatched.index[0]})"
        )

    # 3. Parent field totals should equal sum of their sub-fields (excluding standalone parents)
    parents = fields[fields["is_parent"] == 1]
    subfields = fields[fields["is_parent"] == 0]
    for _, parent_row in parents.iterrows():
        field_code = parent_row["field_code"]
        if field_code in STANDALONE_PARENTS:
            continue
        sub_sum = subfields[
            (subfields["parent_field"] == field_code) & (subfields["inst_id"] == parent_row["inst_id"])
        ]["total"].sum()
        if parent_row["total"] != sub_sum:
            raise ValueError(
                f"{year}: parent field '{field_code}' for inst_id {parent_row['inst_id']} "
                f"(${parent_row['total']:,}) != sum of its sub-fields (${sub_sum:,})"
            )

    # 4. Sum of parent field totals should equal institutions.total_rd, per institution
    parent_totals = parents.groupby("inst_id")["total"].sum()
    inst_total_rd = institutions.set_index("inst_id")["total_rd"]
    joined = pd.concat([inst_total_rd, parent_totals.rename("parent_total")], axis=1).fillna(0)
    mismatched = joined[joined["total_rd"] != joined["parent_total"]]
    if not mismatched.empty:
        raise ValueError(
            f"{year}: {len(mismatched)} institution(s) where sum of parent field totals != total_rd "
            f"(e.g. inst_id {mismatched.index[0]})"
        )


def run(year: int, force_download: bool = False) -> None:
    print(f"=== NSF HERD ingestion: {year} ===")

    print(f"\n[1/4] Downloading {year}...")
    csv_files = download_year(year, RAW_DIR, force=force_download)
    if not csv_files:
        raise RuntimeError(f"No CSV files found/downloaded for {year}")
    csv_path = csv_files[0]
    print(f"   Using {csv_path.name}")

    print(f"\n[2/4] Transforming {year}...")
    institutions = transform_institutions(csv_path, year)
    fields = transform_field_expenditures(csv_path, year)
    agencies = transform_agency_funding(csv_path, year)
    print(f"   {len(institutions)} institutions, {len(fields)} field rows, {len(agencies)} agency rows")

    print(f"\n[3/4] Validating {year} against data invariants...")
    validate(institutions, fields, agencies, year)
    print("   All invariants passed")

    print(f"\n[4/4] Loading {year} into Postgres...")
    row_counts = load_year(year, institutions, fields, agencies)
    print(f"   Loaded: {row_counts}")

    print(f"\n=== {year} loaded successfully ===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the NSF HERD ingestion pipeline for one survey year.")
    parser.add_argument("--year", type=int, required=True, help="Survey year to fetch and load, e.g. 2025")
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Re-download even if CSVs for this year already exist on disk",
    )
    args = parser.parse_args()

    try:
        run(args.year, force_download=args.force_download)
    except Exception as e:
        print(f"\nFAILED: {e}", file=sys.stderr)
        sys.exit(1)
