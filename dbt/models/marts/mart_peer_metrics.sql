-- Per-institution metrics over the configured year window.
-- Used by the API to support peer comparison and gap analysis.
-- CAGR and rank change are the two primary signals.

WITH rankings AS (
    SELECT * FROM {{ ref('mart_rankings') }}
),

-- Snapshot at the end of the window
end_year AS (
    SELECT
        inst_id,
        name,
        state,
        total_rd   AS total_rd_end,
        national_rank AS rank_end
    FROM rankings
    WHERE year = {{ var('end_year') }}
),

-- Snapshot at the start of the window
start_year AS (
    SELECT
        inst_id,
        total_rd   AS total_rd_start,
        national_rank AS rank_start
    FROM rankings
    WHERE year = {{ var('start_year') }}
),

combined AS (
    SELECT
        e.inst_id,
        e.name,
        e.state,
        e.total_rd_end,
        s.total_rd_start,
        e.rank_end,
        s.rank_start,
        {{ var('end_year') }} - {{ var('start_year') }} AS window_years
    FROM end_year e
    LEFT JOIN start_year s ON e.inst_id = s.inst_id
)

SELECT
    inst_id,
    name,
    state,
    total_rd_end,
    total_rd_start,
    rank_end                          AS national_rank,
    rank_start                        AS national_rank_prior,
    -- Positive = improved (rank number went down, e.g. #150 → #130 = +20)
    rank_start - rank_end             AS rank_change,
    window_years,
    {{ cagr('total_rd_start', 'total_rd_end', 'window_years') }} AS cagr_pct
FROM combined
