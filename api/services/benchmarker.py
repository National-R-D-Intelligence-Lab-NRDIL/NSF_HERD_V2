"""
KNN Peer Benchmarker for NSF HERD institutions.

Ported from nsf-herd-mvp/src/benchmarker.py. The KNN logic itself is
unchanged — this is not something dbt can precompute, since it's a
model fit (sklearn), not an aggregation. What changed:
  - Data loads from Postgres (via asyncpg) instead of SQLite.
  - fit() runs once at FastAPI startup, not per-Streamlit-session.
  - get_peer_trend() queries Postgres instead of SQLite for history.
  - Classification-based filtering added (Feature 5).

Why KNN instead of KMeans or resource parity (+-20%)?
- KMeans produces wildly uneven clusters on skewed funding data.
- Resource parity fails for outliers (a $4B institution has ~0 peers
  within 20%; a $200K institution has maybe 1).
- KNN always returns exactly n_peers regardless of where the
  institution sits in the distribution.

Pipeline: log1p every funding column -> StandardScaler -> NearestNeighbors.
total_rd is included alongside the 6 source columns on purpose — since
total_rd = sum of sources, this double-weights overall size, so KNN
matches on size first and funding mix second.

Filtered peer matching (Feature 5):
With ~1,000 institutions and 7 features, brute-force distance computation
is sub-millisecond. When filters are provided, we compute Euclidean
distances against only the masked candidate rows using scipy cdist,
bypassing the pre-fitted KD-tree.
"""

import asyncpg
import pandas as pd
import numpy as np
from dataclasses import dataclass
from scipy.spatial.distance import cdist
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import NearestNeighbors

NUMERIC_COLS = [
    "total_rd",
    "federal",
    "state_local",
    "business",
    "nonprofit",
    "institutional",
    "other_sources",
]

FEATURES_QUERY = """
SELECT inst_id, name, state, total_rd, federal, state_local,
       business, nonprofit, institutional, other_sources
FROM stg_institutions
WHERE year = (SELECT MAX(year) FROM stg_institutions)
ORDER BY name;
"""

CLASSIFICATIONS_QUERY = """
SELECT inst_id, carnegie_class, control, has_med_school,
       is_aau, is_aplu, is_hbcu, is_hsi, is_epscor
FROM stg_institution_classifications;
"""

TREND_QUERY = """
SELECT
    i.inst_id,
    i.year,
    i.total_rd,
    COALESCE(latest.name, i.name) AS name
FROM stg_institutions i
LEFT JOIN (
    SELECT inst_id, name FROM stg_institutions
    WHERE year = (SELECT MAX(year) FROM stg_institutions)
) latest ON i.inst_id = latest.inst_id
WHERE i.inst_id = ANY($1::text[])
  AND i.year BETWEEN $2 AND $3
ORDER BY i.inst_id, i.year;
"""


@dataclass
class PeerFilters:
    """Classification-based filters for narrowing the peer candidate pool."""
    carnegie: list[str] | None = None       # e.g. ['R1', 'R2']
    control: str | None = None              # 'Public' or 'Private'
    exclude_med: bool = False
    aau_only: bool = False
    aplu_only: bool = False
    hbcu_only: bool = False
    hsi_only: bool = False
    epscor_only: bool = False


async def fetch_university_features(pool: asyncpg.Pool) -> pd.DataFrame:
    """Load one row per institution (latest survey year) from Postgres."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(FEATURES_QUERY)
    df = pd.DataFrame([dict(r) for r in rows])
    df = df.dropna(subset=NUMERIC_COLS, how="all")
    df[NUMERIC_COLS] = df[NUMERIC_COLS].fillna(0)
    return df


async def fetch_classifications(pool: asyncpg.Pool) -> pd.DataFrame:
    """Load classification data for all institutions."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(CLASSIFICATIONS_QUERY)
    if not rows:
        return pd.DataFrame(columns=[
            "inst_id", "carnegie_class", "control", "has_med_school",
            "is_aau", "is_aplu", "is_hbcu", "is_hsi", "is_epscor",
        ])
    return pd.DataFrame([dict(r) for r in rows])


class AutoBenchmarker:
    """KNN-based peer finder for HERD institutions."""

    def __init__(self, n_peers: int = 20):
        self.n_peers = n_peers
        self.scaler = None
        self.nn_model = None
        self._data = None
        self._scaled = None
        self._classifications = None

    @property
    def data(self) -> pd.DataFrame:
        return pd.DataFrame() if self._data is None else self._data.copy()

    @property
    def classifications(self) -> pd.DataFrame:
        return pd.DataFrame() if self._classifications is None else self._classifications.copy()

    def fit(self, df: pd.DataFrame, classifications_df: pd.DataFrame | None = None) -> "AutoBenchmarker":
        self._data = df.copy().reset_index(drop=True)
        log_features = np.log1p(self._data[NUMERIC_COLS])
        self.scaler = StandardScaler()
        self._scaled = self.scaler.fit_transform(log_features)
        self.nn_model = NearestNeighbors(
            n_neighbors=min(self.n_peers + 1, len(self._data)),
            metric="euclidean",
            algorithm="auto",
        )
        self.nn_model.fit(self._scaled)

        # Store classifications aligned to _data by inst_id
        if classifications_df is not None and not classifications_df.empty:
            self._classifications = self._data[["inst_id"]].merge(
                classifications_df, on="inst_id", how="left"
            )
        else:
            self._classifications = None

        return self

    def get_peer_inst_ids(self, target_inst_id: str, n: int = None, filters: PeerFilters | None = None) -> list:
        self._check_fitted()
        if filters and self._has_active_filters(filters):
            return self._get_filtered_peers(target_inst_id, n=n, filters=filters)
        peer_indices = self._peer_indices(target_inst_id, n=n)
        return self._data.loc[peer_indices, "inst_id"].tolist()

    def get_candidate_pool_size(self, target_inst_id: str, filters: PeerFilters | None = None) -> dict:
        """Return total institutions and filtered count for UI display."""
        total = len(self._data)
        if filters and self._has_active_filters(filters) and self._classifications is not None:
            mask = self._build_filter_mask(filters)
            # Exclude the target itself from count
            target_mask = self._data["inst_id"] != target_inst_id
            filtered = int((mask & target_mask).sum())
        else:
            filtered = total - 1  # exclude self
        return {"total": total, "filtered": filtered}

    def analyze_gap(self, target_inst_id: str, n: int = None, filters: PeerFilters | None = None) -> list:
        self._check_fitted()
        target_row = self._find_target(target_inst_id)

        if filters and self._has_active_filters(filters):
            peer_indices = self._get_filtered_peer_indices(target_inst_id, n=n, filters=filters)
        else:
            peer_indices = self._peer_indices(target_inst_id, n=n)

        peer_avg = self._data.loc[peer_indices, NUMERIC_COLS].mean()

        gaps = []
        for col in NUMERIC_COLS:
            my_val = float(target_row[col].values[0])
            avg_val = float(peer_avg[col])
            gaps.append({
                "metric": col,
                "my_val": round(my_val, 2),
                "peer_avg": round(avg_val, 2),
                "gap": round(my_val - avg_val, 2),
            })
        return gaps

    async def get_peer_trend(
        self,
        target_inst_id: str,
        pool: asyncpg.Pool,
        start_year: int = 2019,
        end_year: int = 2024,
        n: int = None,
        filters: PeerFilters | None = None,
    ) -> tuple:
        self._check_fitted()
        target_row = self._find_target(target_inst_id)
        target_name = target_row["name"].values[0]

        if filters and self._has_active_filters(filters):
            peer_indices = self._get_filtered_peer_indices(target_inst_id, n=n, filters=filters)
        else:
            peer_indices = self._peer_indices(target_inst_id, n=n)

        peer_inst_ids = self._data.loc[peer_indices, "inst_id"].tolist()
        all_inst_ids = [target_inst_id] + peer_inst_ids

        async with pool.acquire() as conn:
            rows = await conn.fetch(TREND_QUERY, all_inst_ids, start_year, end_year)
        trend_df = pd.DataFrame([dict(r) for r in rows])
        trend_df["is_target"] = trend_df["inst_id"] == target_inst_id

        cagrs = {}
        for iid in all_inst_ids:
            inst = trend_df[trend_df["inst_id"] == iid].sort_values("year")
            if len(inst) < 2:
                continue
            first_row, last_row = inst.iloc[0], inst.iloc[-1]
            s, e = float(first_row["total_rd"]), float(last_row["total_rd"])
            actual_years = int(last_row["year"]) - int(first_row["year"])
            if s > 0 and actual_years > 0:
                display_name = inst["name"].iloc[0]
                cagrs[display_name] = round(((e / s) ** (1 / actual_years) - 1) * 100, 1)

        target_cagr = cagrs.get(target_name, 0.0)
        peer_cagrs = [v for k, v in cagrs.items() if k != target_name]
        peer_avg_cagr = round(sum(peer_cagrs) / len(peer_cagrs), 1) if peer_cagrs else 0.0
        growth_rank = sum(1 for c in peer_cagrs if c > target_cagr) + 1

        stats = {
            "target_cagr": target_cagr,
            "peer_avg_cagr": peer_avg_cagr,
            "growth_rank": growth_rank,
            "total_in_group": len(cagrs),
        }
        return trend_df, stats

    # ------------------------------------------------------------------
    # Custom (user-defined) peer methods
    # Bypass KNN -- accept an explicit list of peer inst_ids.
    # ------------------------------------------------------------------
    def analyze_gap_custom(self, target_inst_id: str, custom_peer_inst_ids: list) -> list:
        """Same output as analyze_gap, but averages over a user-picked peer set."""
        self._check_fitted()
        target_row = self._find_target(target_inst_id)
        peer_rows = self._data[self._data["inst_id"].isin(custom_peer_inst_ids)]
        if peer_rows.empty:
            return []

        peer_avg = peer_rows[NUMERIC_COLS].mean()
        gaps = []
        for col in NUMERIC_COLS:
            my_val = float(target_row[col].values[0])
            avg_val = float(peer_avg[col])
            gaps.append({
                "metric": col,
                "my_val": round(my_val, 2),
                "peer_avg": round(avg_val, 2),
                "gap": round(my_val - avg_val, 2),
            })
        return gaps

    async def get_peer_trend_custom(
        self,
        target_inst_id: str,
        pool: asyncpg.Pool,
        custom_peer_inst_ids: list,
        start_year: int = 2019,
        end_year: int = 2024,
    ) -> tuple:
        """Same output as get_peer_trend, but for a user-picked peer set.

        growth_rank is None -- rank within a hand-picked group isn't
        analytically meaningful.
        """
        self._check_fitted()
        target_row = self._find_target(target_inst_id)
        target_name = target_row["name"].values[0]

        all_inst_ids = [target_inst_id] + list(custom_peer_inst_ids)
        async with pool.acquire() as conn:
            rows = await conn.fetch(TREND_QUERY, all_inst_ids, start_year, end_year)
        trend_df = pd.DataFrame([dict(r) for r in rows])
        trend_df["is_target"] = trend_df["inst_id"] == target_inst_id

        cagrs = {}
        for iid in all_inst_ids:
            inst = trend_df[trend_df["inst_id"] == iid].sort_values("year")
            if len(inst) < 2:
                continue
            first_row, last_row = inst.iloc[0], inst.iloc[-1]
            s, e = float(first_row["total_rd"]), float(last_row["total_rd"])
            actual_years = int(last_row["year"]) - int(first_row["year"])
            if s > 0 and actual_years > 0:
                display_name = inst["name"].iloc[0]
                cagrs[display_name] = round(((e / s) ** (1 / actual_years) - 1) * 100, 1)

        target_cagr = cagrs.get(target_name, 0.0)
        peer_cagrs = [v for k, v in cagrs.items() if k != target_name]
        peer_avg_cagr = round(sum(peer_cagrs) / len(peer_cagrs), 1) if peer_cagrs else 0.0

        stats = {
            "target_cagr": target_cagr,
            "peer_avg_cagr": peer_avg_cagr,
            "growth_rank": None,
            "total_in_group": len(cagrs),
        }
        return trend_df, stats

    # ------------------------------------------------------------------
    # Filtered peer matching (Feature 5)
    # ------------------------------------------------------------------
    def _has_active_filters(self, filters: PeerFilters) -> bool:
        """Check if any filter is actually set."""
        if self._classifications is None:
            return False
        return (
            filters.carnegie is not None
            or filters.control is not None
            or filters.exclude_med
            or filters.aau_only
            or filters.aplu_only
            or filters.hbcu_only
            or filters.hsi_only
            or filters.epscor_only
        )

    def _build_filter_mask(self, filters: PeerFilters) -> np.ndarray:
        """Build a boolean mask over self._data rows based on classification filters."""
        mask = np.ones(len(self._data), dtype=bool)
        clf = self._classifications

        if filters.carnegie:
            mask &= clf["carnegie_class"].isin(filters.carnegie).values
        if filters.control:
            mask &= (clf["control"] == filters.control).values
        if filters.exclude_med:
            mask &= (~clf["has_med_school"].fillna(False)).values
        if filters.aau_only:
            mask &= clf["is_aau"].fillna(False).values
        if filters.aplu_only:
            mask &= clf["is_aplu"].fillna(False).values
        if filters.hbcu_only:
            mask &= clf["is_hbcu"].fillna(False).values
        if filters.hsi_only:
            mask &= clf["is_hsi"].fillna(False).values
        if filters.epscor_only:
            mask &= clf["is_epscor"].fillna(False).values

        return mask

    def _get_filtered_peer_indices(self, target_inst_id: str, n: int = None, filters: PeerFilters = None) -> list:
        """Get peer indices using brute-force distance on filtered subset."""
        effective_n = n if n is not None else self.n_peers
        target_row = self._find_target(target_inst_id)
        target_idx = target_row.index[0]

        mask = self._build_filter_mask(filters)
        # Exclude the target institution itself
        mask[target_idx] = False

        candidate_indices = np.where(mask)[0]
        if len(candidate_indices) == 0:
            return []

        # Compute distances from target to all candidates
        target_vec = self._scaled[target_idx].reshape(1, -1)
        candidate_vecs = self._scaled[candidate_indices]
        distances = cdist(target_vec, candidate_vecs, metric="euclidean")[0]

        # Return top-k closest
        k = min(effective_n, len(candidate_indices))
        top_k_local = np.argsort(distances)[:k]
        return candidate_indices[top_k_local].tolist()

    def _get_filtered_peers(self, target_inst_id: str, n: int = None, filters: PeerFilters = None) -> list:
        """Return peer inst_ids from the filtered candidate pool."""
        peer_indices = self._get_filtered_peer_indices(target_inst_id, n=n, filters=filters)
        return self._data.loc[peer_indices, "inst_id"].tolist()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _check_fitted(self) -> None:
        if self.nn_model is None or self._data is None:
            raise RuntimeError("AutoBenchmarker has not been fitted yet. Call fit() first.")

    def _find_target(self, target_inst_id: str) -> pd.DataFrame:
        target_row = self._data[self._data["inst_id"] == target_inst_id]
        if target_row.empty:
            raise KeyError(f"Institution '{target_inst_id}' not found in fitted data.")
        return target_row

    def _peer_indices(self, target_inst_id: str, n: int = None) -> list:
        effective_n = n if n is not None else self.n_peers
        target_row = self._find_target(target_inst_id)
        target_idx = target_row.index[0]
        _, indices = self.nn_model.kneighbors(self._scaled[target_idx].reshape(1, -1))
        neighbor_indices = [int(i) for i in indices[0] if i != target_idx]
        return neighbor_indices[:effective_n]
