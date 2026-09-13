"""
NSF HERD data transforms: raw long-format microdata -> the three wide
per-institution tables this app's Postgres schema expects.

Ported from nsf-herd-mvp/scripts/etl/2_transform.py, 4_transform_fields.py,
and 5_transform_agencies.py. The parsing logic is unchanged (proven correct
across all 15 existing years) -- each transform is just reshaped to return
a DataFrame for one year instead of writing a combined CSV for all years.
"""

import re
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Institutions (Q1 funding sources) -- ported from 2_transform.py
# ---------------------------------------------------------------------------

_ROW_VALUE_REPLACEMENTS = {
    "federal_government": "federal",
    "state_and_local_government": "state_local",
    "nonprofit_organizations": "nonprofit",
    "institution_funds": "institutional",
    "all_other_sources": "other_sources",
    "total": "total_rd",
}


def _standardize_row_value(row_val) -> str | None:
    if pd.isna(row_val):
        return None
    clean = str(row_val).lower().strip()
    clean = re.sub(r"[^\w\s]", "", clean)
    clean = re.sub(r"\s+", "_", clean)
    return _ROW_VALUE_REPLACEMENTS.get(clean, clean)


def _clean_institution_names(df: pd.DataFrame) -> pd.DataFrame:
    """NSF inconsistently appends ", The" to some institution names --
    move it to the front, e.g. "University of Alabama, The" -> "The
    University of Alabama"."""

    def clean_name(name):
        if pd.isna(name):
            return name
        if re.search(r",\s*The\s*$", name, re.IGNORECASE):
            stripped = re.sub(r",\s*The\s*$", "", name, flags=re.IGNORECASE).strip()
            return f"The {stripped}"
        return name

    df["name"] = df["name"].apply(clean_name)
    return df


def _read_raw_csv(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, encoding="latin-1", dtype={"inst_id": str}, low_memory=False)
    df.columns = df.columns.str.strip()
    return df


def transform_institutions(csv_path: Path, year: int) -> pd.DataFrame:
    """Q1 funding-source rows (01.a-01.g) -> one wide row per institution."""
    df = _read_raw_csv(csv_path)
    df["questionnaire_no"] = df["questionnaire_no"].astype(str)

    df_q1 = df[df["questionnaire_no"].str.match(r"^01\.[a-g]$", na=False)].copy()
    if df_q1.empty:
        raise ValueError(f"No Q1 (funding source) data found for {year}")

    q1_mapping = {}
    for quest_no in df_q1["questionnaire_no"].unique():
        sample = df_q1[df_q1["questionnaire_no"] == quest_no]
        row_val = sample["row"].iloc[0]
        col_name = _standardize_row_value(row_val)
        if col_name:
            q1_mapping[quest_no] = col_name

    rows = []
    for inst_id in df_q1["inst_id"].unique():
        inst_data = df_q1[df_q1["inst_id"] == inst_id]
        row = {
            "inst_id": str(inst_id),
            "name": inst_data["inst_name_long"].iloc[0],
            "city": inst_data["inst_city"].iloc[0],
            "state": inst_data["inst_state_code"].iloc[0],
            "year": int(inst_data["year"].iloc[0]),
        }
        for quest_no, col_name in q1_mapping.items():
            matching = inst_data[inst_data["questionnaire_no"] == quest_no]
            if len(matching) > 0 and pd.notna(matching["data"].iloc[0]):
                row[col_name] = int(matching["data"].iloc[0] * 1000)
            else:
                row[col_name] = 0
        rows.append(row)

    result = pd.DataFrame(rows)
    result = _clean_institution_names(result)
    result["inst_id"] = result["inst_id"].astype(str)

    required = ["total_rd", "federal", "state_local", "business", "nonprofit", "institutional", "other_sources"]
    missing = [c for c in required if c not in result.columns]
    if missing:
        raise ValueError(
            f"{year}: NSF's funding-source labels didn't map to the expected columns "
            f"{missing} -- their survey format may have changed. Inspect the raw CSV "
            f"before loading this year."
        )
    return result[["inst_id", "name", "city", "state", "year"] + required]


# ---------------------------------------------------------------------------
# Field expenditures (Q09 + Q11) -- ported from 4_transform_fields.py
# ---------------------------------------------------------------------------

FIELD_TAXONOMY = {
    "Computer and information sciences, all": ("cs", "cs", True),
    "Engineering, all": ("engineering", "engineering", True),
    "Engineering, aerospace, aeronautical, and astronautical": ("eng_aerospace", "engineering", False),
    "Engineering, bioengineering and biomedical engineering": ("eng_biomedical", "engineering", False),
    "Engineering, chemical": ("eng_chemical", "engineering", False),
    "Engineering, civil": ("eng_civil", "engineering", False),
    "Engineering, electrical, electronic, and communications": ("eng_electrical", "engineering", False),
    "Engineering, industrial and manufacturing": ("eng_industrial", "engineering", False),
    "Engineering, mechanical": ("eng_mechanical", "engineering", False),
    "Engineering, metallurgical and materials": ("eng_materials", "engineering", False),
    "Engineering, other": ("eng_other", "engineering", False),
    "Geosciences, atmospheric sciences, and ocean sciences, all": ("geosciences", "geosciences", True),
    "Geosciences, atmospheric sciences, and ocean sciences, atmospheric science and meteorology": ("geo_atmospheric", "geosciences", False),
    "Geosciences, atmospheric sciences, and ocean sciences, geological and earth sciences": ("geo_earth", "geosciences", False),
    "Geosciences, atmospheric sciences, and ocean sciences, ocean sciences and marine sciences": ("geo_ocean", "geosciences", False),
    "Geosciences, atmospheric sciences, and ocean sciences, other": ("geo_other", "geosciences", False),
    "Life sciences, all": ("life_sciences", "life_sciences", True),
    "Life sciences, agricultural sciences": ("life_agricultural", "life_sciences", False),
    "Life sciences, biological and biomedical sciences": ("life_biomedical", "life_sciences", False),
    "Life sciences, health sciences": ("life_health", "life_sciences", False),
    "Life sciences, natural resources and conservation": ("life_natural_resources", "life_sciences", False),
    "Life sciences, other": ("life_other", "life_sciences", False),
    "Mathematics and statistics, all": ("math", "math", True),
    "Physical sciences, all": ("physical_sciences", "physical_sciences", True),
    "Physical sciences, astronomy and astrophysics": ("phys_astronomy", "physical_sciences", False),
    "Physical sciences, chemistry": ("phys_chemistry", "physical_sciences", False),
    "Physical sciences, materials science": ("phys_materials", "physical_sciences", False),
    "Physical sciences, physics": ("phys_physics", "physical_sciences", False),
    "Physical sciences, other": ("phys_other", "physical_sciences", False),
    "Psychology, all": ("psychology", "psychology", True),
    "Social sciences, all": ("social_sciences", "social_sciences", True),
    "Social sciences, anthropology": ("soc_anthropology", "social_sciences", False),
    "Social sciences, economics": ("soc_economics", "social_sciences", False),
    "Social sciences, political science and government": ("soc_political", "social_sciences", False),
    "Social sciences, sociology, demography, and population studies": ("soc_sociology", "social_sciences", False),
    "Social sciences, other": ("soc_other", "social_sciences", False),
    "Other sciences, all": ("other_sciences", "other_sciences", True),
    "Non-S&E, all": ("non_se", "non_se", True),
    "Non-S&E, business management and business administration": ("nse_business", "non_se", False),
    "Non-S&E, communication and communications technologies": ("nse_communication", "non_se", False),
    "Non-S&E, education": ("nse_education", "non_se", False),
    "Non-S&E, humanities": ("nse_humanities", "non_se", False),
    "Non-S&E, law": ("nse_law", "non_se", False),
    "Non-S&E, social work": ("nse_social_work", "non_se", False),
    "Non-S&E, visual and performing arts": ("nse_arts", "non_se", False),
    "Non-S&E, other": ("nse_other", "non_se", False),
}
KNOWN_FIELDS = set(FIELD_TAXONOMY.keys())


def transform_field_expenditures(csv_path: Path, year: int) -> pd.DataFrame:
    df = _read_raw_csv(csv_path)

    q09 = df[
        (df["question"] == "Federal expenditures by field and agency")
        & (df["row"].isin(KNOWN_FIELDS))
        & (df["column"] == "Total")
    ][["inst_id", "row", "data"]].rename(columns={"row": "field_name", "data": "federal"})

    q11 = df[
        (df["question"] == "Nonfederal expenditures by field and source")
        & (df["row"].isin(KNOWN_FIELDS))
        & (df["column"] == "Total")
    ][["inst_id", "row", "data"]].rename(columns={"row": "field_name", "data": "nonfederal"})

    merged = pd.merge(q09, q11, on=["inst_id", "field_name"], how="outer")
    merged["federal"] = (merged["federal"].fillna(0) * 1000).astype(int)
    merged["nonfederal"] = (merged["nonfederal"].fillna(0) * 1000).astype(int)
    merged["total"] = merged["federal"] + merged["nonfederal"]
    merged["year"] = year

    taxonomy = merged["field_name"].map(FIELD_TAXONOMY)
    merged["field_code"] = taxonomy.apply(lambda x: x[0] if x else None)
    merged["parent_field"] = taxonomy.apply(lambda x: x[1] if x else None)
    merged["is_parent"] = taxonomy.apply(lambda x: int(x[2]) if x else None)

    unmapped = merged[merged["field_code"].isna()]
    if not unmapped.empty:
        unknown = unmapped["field_name"].unique().tolist()
        raise ValueError(
            f"{year}: NSF reported field(s) not in FIELD_TAXONOMY: {unknown} -- "
            f"add them to ingestion/transform.py before loading this year."
        )

    return merged[
        ["inst_id", "year", "field_code", "parent_field", "is_parent", "field_name", "federal", "nonfederal", "total"]
    ].sort_values(["inst_id", "is_parent", "field_code"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Agency funding (Q09, row="All") -- ported from 5_transform_agencies.py
# ---------------------------------------------------------------------------

AGENCIES = ["DOD", "DOE", "HHS", "NASA", "NSF", "USDA", "Other agencies"]
AGENCY_DISPLAY = {
    "DOD": "Dept of Defense",
    "DOE": "Dept of Energy",
    "HHS": "HHS (incl. NIH)",
    "NASA": "NASA",
    "NSF": "NSF",
    "USDA": "USDA",
    "Other agencies": "Other Federal",
}


def transform_agency_funding(csv_path: Path, year: int) -> pd.DataFrame:
    df = _read_raw_csv(csv_path)

    q09_all = df[
        (df["question"] == "Federal expenditures by field and agency")
        & (df["row"] == "All")
        & (df["column"].isin(AGENCIES))
    ][["inst_id", "column", "data"]].rename(columns={"column": "agency_code", "data": "amount"})

    q09_all["amount"] = (q09_all["amount"].fillna(0) * 1000).astype(int)
    q09_all["year"] = year
    q09_all["agency_name"] = q09_all["agency_code"].map(AGENCY_DISPLAY)

    return q09_all[["inst_id", "year", "agency_code", "agency_name", "amount"]].sort_values(
        ["inst_id", "agency_code"]
    ).reset_index(drop=True)
