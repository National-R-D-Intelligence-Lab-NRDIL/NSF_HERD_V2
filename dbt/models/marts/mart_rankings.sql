-- National and state rank for every institution for every year.
-- This is the foundation that all peer comparison logic builds on.

WITH institutions AS (
    SELECT * FROM {{ ref('stg_institutions') }}
)

SELECT
    inst_id,
    name,
    state,
    year,
    total_rd,
    federal,
    -- National rank: #1 = highest total R&D that year
    RANK() OVER (
        PARTITION BY year
        ORDER BY total_rd DESC
    ) AS national_rank,
    -- State rank: #1 = highest total R&D in that state that year
    RANK() OVER (
        PARTITION BY year, state
        ORDER BY total_rd DESC
    ) AS state_rank
FROM institutions
WHERE total_rd > 0
