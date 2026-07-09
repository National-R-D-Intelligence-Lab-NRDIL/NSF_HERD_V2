"""
KNN Peer Benchmarker for NSF HERD institutions.

Ported from nsf-herd-mvp/src/benchmarker.py. The KNN logic itself is
unchanged — this is not something dbt can precompute, since it's a
model fit (sklearn), not an aggregation. What changed:
  - Data loads from Postgres (via asyncpg) instead of SQLite.
  - fit() runs once at FastAPI startup, not per-Streamlit-session.
  - get_peer_trend() queries Postgres instead of SQLite for history.

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
"""

import asyncpg
import pandas as pd
import numpy as np
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


async def fetch_university_features(pool: asyncpg.Pool) -> pd.DataFrame:
    """Load one row per institution (latest survey year) from Postgres."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(FEATURES_QUERY)
    df = pd.DataFrame([dict(r) for r in rows])
    df = df.dropna(subset=NUMERIC_COLS, how="all")
    df[NUMERIC_COLS] = df[NUMERIC_COLS].fillna(0)
    return df


class AutoBenchmarker:
    """KNN-based peer finder for HERD institutions."""

    def __init__(self, n_peers: int = 20):
        self.n_peers = n_peers
        self.scaler = None
        self.nn_model = None
        self._data = None
        self._scaled = None

    @property
    def data(self) -> pd.DataFrame:
        return pd.DataFrame() if self._data is None else self._data.copy()

    def fit(self, df: pd.DataFrame) -> "AutoBenchmarker":
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
        return self

    def get_peer_inst_ids(self, target_inst_id: str, n: int = None) -> list:
        self._check_fitted()
        peer_indices = self._peer_indices(target_inst_id, n=n)
        return self._data.loc[peer_indices, "inst_id"].tolist()

    def analyze_gap(self, target_inst_id: str, n: int = None) -> list:
        self._check_fitted()
        target_row = self._find_target(target_inst_id)
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
    ) -> tuple:
        self._check_fitted()
        target_row = self._find_target(target_inst_id)
        target_name = target_row["name"].values[0]

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
