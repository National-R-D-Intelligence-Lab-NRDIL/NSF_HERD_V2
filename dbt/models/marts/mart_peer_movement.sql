-- Rank trajectory and convergence signals over the configured window.
-- The API uses this to flag peers that are closing the gap on a target institution.
-- A negative rank_delta means the institution improved (rank number went down).

WITH peer_ranks AS (
    SELECT
        inst_id,
        name,
        state,
        year,
        total_rd,
        RANK() OVER (
            PARTITION BY year
            ORDER BY total_rd DESC
        ) AS national_rank
    FROM {{ ref('stg_institutions') }}
    WHERE total_rd > 0
),

pivoted AS (
    SELECT
        inst_id,
        MAX(name)  AS name,
        MAX(state) AS state,
        MAX(CASE WHEN year = {{ var('end_year') }}   THEN national_rank END) AS rank_current,
        MAX(CASE WHEN year = {{ var('start_year') }} THEN national_rank END) AS rank_prior,
        MAX(CASE WHEN year = {{ var('end_year') }}   THEN total_rd END)      AS total_rd_current,
        MAX(CASE WHEN year = {{ var('start_year') }} THEN total_rd END)      AS total_rd_prior
    FROM peer_ranks
    GROUP BY inst_id
)

SELECT
    inst_id,
    name,
    state,
    rank_current,
    rank_prior,
    -- Negative = improved (moved up the rankings)
    rank_current - rank_prior                                     AS rank_delta,
    total_rd_current,
    total_rd_prior,
    {{ cagr('total_rd_prior', 'total_rd_current', var('end_year') - var('start_year')) }} AS cagr_pct,
    -- Convergence flag: institution is moving up AND has positive CAGR
    CASE
        WHEN rank_current < rank_prior
         AND total_rd_current > total_rd_prior
        THEN TRUE
        ELSE FALSE
    END AS is_converging
FROM pivoted
WHERE rank_current IS NOT NULL
