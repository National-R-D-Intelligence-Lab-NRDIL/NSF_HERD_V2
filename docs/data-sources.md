# Data Sources Reference

All classification data used in the peer benchmarking filters is sourced from official, publicly available datasets. This document tracks what we use, where it comes from, how often it refreshes, and when we last loaded it.

---

## Core HERD Data

| Dataset | Source | URL | Format | Refresh Cycle | Last Loaded | Notes |
|---------|--------|-----|--------|---------------|-------------|-------|
| NSF HERD Survey | National Center for Science and Engineering Statistics (NCSES) | https://ncses.nsf.gov/surveys/higher-education-research-development | CSV/Excel | Annual (Nov–Dec) | 2026-06-27 | Primary dataset. Institutions, fields, agencies. FY2010–2024. |

---

## Institution Classification Data

| Dataset | Source | URL | Format | Refresh Cycle | Last Loaded | Script | Notes |
|---------|--------|-----|--------|---------------|-------------|--------|-------|
| Carnegie Classification (2021) | IPEDS via Urban Institute Education Data Portal | https://educationdata.urban.org/api/v1/college-university/ipeds/directory/2022/ | JSON API | Every 3–5 years (next: 2025 published) | 2026-07-11 | `scripts/load_classifications.py` | Field: `cc_basic_2021`. Codes: 15=R1, 16=R2, 17=D/PU, 29-30=Special Focus Medical |
| Institutional Control (Public/Private) | IPEDS via Urban Institute Education Data Portal | https://educationdata.urban.org/api/v1/college-university/ipeds/directory/2022/ | JSON API | Annual (fall release) | 2026-07-11 | `scripts/load_classifications.py` | Field: `inst_control`. 1=Public, 2=Private nonprofit, 3=Private for-profit |
| Medical Degree Flag | IPEDS via Urban Institute Education Data Portal | https://educationdata.urban.org/api/v1/college-university/ipeds/directory/2022/ | JSON API | Annual | 2026-07-11 | `scripts/load_classifications.py` | Field: `medical_degree`. 1=offers MD, 0=does not |
| HBCU Designation | U.S. Department of Education, Office of Postsecondary Education | https://www2.ed.gov/about/offices/list/ope/idues/eligibility.html | Excel (.xlsx) | Stable (statutory list, rarely changes) | 2026-07-11 | `scripts/load_classifications.py` | Sheet: "HBCU" in FY2025 Eligibility Matrix. Matched via UNITID. |
| HSI Designation (Title V) | U.S. Department of Education, Office of Postsecondary Education | https://www.ed.gov/media/document/ope-2025-eligibility-matrix-62325-110283.xlsx | Excel (.xlsx) | Annual (spring, with eligibility cycle) | 2026-07-11 | `scripts/load_classifications.py` | Sheet: "HSI" in FY2025 Eligibility Matrix. 25%+ Hispanic FTE enrollment. Matched via UNITID. |
| AAU Membership | Association of American Universities | https://aau.edu/who-we-are/our-members | HTML (manual) | Rarely changes (membership votes) | 2026-07-11 | dbt seed: `dbt/seeds/seed_aau_members.csv` | 71 member institutions. Update CSV when membership changes (newsworthy events). |
| APLU Membership | Association of Public and Land-grant Universities | https://www.aplu.org/members/ | HTML (manual) | Rarely changes | 2026-07-11 | dbt seed: `dbt/seeds/seed_aplu_members.csv` | ~226 member institutions. Update CSV when membership changes. |
| EPSCoR State Eligibility | NSF EPSCoR Program | https://new.nsf.gov/funding/initiatives/epscor/eligible-jurisdictions | HTML (list) | Frozen through FY2028 | 2026-07-11 | dbt seed: `dbt/seeds/seed_epscor_states.csv` | 28 states/territories. Next review after FY2028. |

---

## Crosswalk / Matching

| Crosswalk | Method | Match Rate | Notes |
|-----------|--------|-----------|-------|
| HERD inst_id ↔ IPEDS UNITID | Fuzzy name + state matching (rapidfuzz, token_sort_ratio, cutoff=70) | 645/681 (94.7%) | 36 institutions unmatched due to name variations (e.g., multi-campus systems, name changes). Unmatched institutions get `Unknown` for Carnegie/control. |
| IPEDS UNITID ↔ DoE HSI/HBCU | Exact UNITID join | 100% (by definition) | DoE eligibility matrix uses UNITID as primary key. |

---

## Refresh Procedures

### Annual (when new HERD data is released, Nov–Dec)

1. Load new HERD survey data (existing pipeline)
2. Re-run `python scripts/load_classifications.py` — re-downloads IPEDS, re-matches
3. Run `dbt run` to rebuild staging view
4. Restart API

### Annual (when DoE publishes new eligibility matrix, spring)

1. Download new eligibility matrix Excel from: https://www2.ed.gov/about/offices/list/ope/idues/eligibility.html
2. Save as `scripts/doe_eligibility_2025.xlsx` (update filename/year)
3. Update `DOE_ELIGIBILITY_URL` in `scripts/load_classifications.py`
4. Re-run `python scripts/load_classifications.py`
5. Restart API

### When Carnegie publishes a new classification (every 3–5 years, next ~2025/2028)

1. The Urban Institute API will update its `cc_basic_YYYY` field
2. Update `CARNEGIE_R1_CODES` etc. in `scripts/load_classifications.py` if code values change
3. Re-run the script

### When AAU/APLU membership changes (rare, newsworthy)

1. Edit `dbt/seeds/seed_aau_members.csv` or `dbt/seeds/seed_aplu_members.csv`
2. Run `dbt seed`
3. Re-run `python scripts/load_classifications.py`
4. Restart API

---

## API Endpoints for Classification Data

| Endpoint | Description |
|----------|-------------|
| `GET /classifications/{inst_id}` | Returns all classification fields for one institution |
| `GET /classifications/options` | Returns distinct values + counts for filter dropdowns |

---

## Data Quality Checks

| Check | Location | Behavior |
|-------|----------|----------|
| Classification coverage ≥ 95% | `dbt/tests/assert_classification_coverage.sql` | Warns if >5% of latest-year institutions lack classification data |
| Carnegie accepted values | `dbt/models/staging/_staging.yml` | Fails if unexpected Carnegie class appears |
| Control accepted values | `dbt/models/staging/_staging.yml` | Fails if control not in (Public, Private, Unknown) |
| inst_id not null + unique | `dbt/models/staging/_staging.yml` | Standard dbt test |

---

## File Inventory

| File | Purpose |
|------|---------|
| `scripts/load_classifications.py` | Main loader — downloads IPEDS + DoE, matches, writes to Postgres |
| `scripts/doe_eligibility_2025.xlsx` | Cached DoE eligibility matrix (re-download annually) |
| `dbt/seeds/seed_aau_members.csv` | AAU member inst_ids (manually maintained) |
| `dbt/seeds/seed_aplu_members.csv` | APLU member inst_ids (manually maintained) |
| `dbt/seeds/seed_epscor_states.csv` | EPSCoR-eligible state codes |
| `dbt/models/staging/stg_institution_classifications.sql` | Staging view over raw_institution_classifications |
| `dbt/tests/assert_classification_coverage.sql` | Coverage quality test |
