-- Forward projection of R&D totals at current growth rates.
-- IMPORTANT: These are trajectories, not predictions. Always labeled "at current growth rates."
-- Projects 1, 2, and 3 years beyond end_year using each institution's 5-year CAGR.

WITH metrics AS (
    SELECT * FROM {{ ref('mart_peer_metrics') }}
),

rankings AS (
    SELECT inst_id, national_rank AS baseline_rank
    FROM {{ ref('mart_rankings') }}
    WHERE year = {{ var('end_year') }}
)

SELECT
    m.inst_id,
    m.name,
    m.state,
    m.total_rd_end                                      AS baseline_total_rd,
    r.baseline_rank,
    m.cagr_pct,
    {{ var('end_year') }}                               AS projection_base_year,

    -- Projected totals (NULL if CAGR is unavailable)
    CASE
        WHEN m.cagr_pct IS NOT NULL
        THEN ROUND(m.total_rd_end * POWER(1 + m.cagr_pct / 100.0, 1))
        ELSE NULL
    END AS projected_1yr,

    CASE
        WHEN m.cagr_pct IS NOT NULL
        THEN ROUND(m.total_rd_end * POWER(1 + m.cagr_pct / 100.0, 2))
        ELSE NULL
    END AS projected_2yr,

    CASE
        WHEN m.cagr_pct IS NOT NULL
        THEN ROUND(m.total_rd_end * POWER(1 + m.cagr_pct / 100.0, 3))
        ELSE NULL
    END AS projected_3yr

FROM metrics m
JOIN rankings r ON m.inst_id = r.inst_id
