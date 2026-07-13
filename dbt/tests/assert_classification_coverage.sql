-- Warn if more than 5% of latest-year institutions have no classification row.
-- This ensures the classification table stays in sync with the institution table.

WITH latest_year AS (
    SELECT MAX(year) AS max_year FROM {{ ref('stg_institutions') }}
),
institution_count AS (
    SELECT COUNT(DISTINCT inst_id) AS total
    FROM {{ ref('stg_institutions') }}
    WHERE year = (SELECT max_year FROM latest_year)
),
classified_count AS (
    SELECT COUNT(DISTINCT c.inst_id) AS classified
    FROM {{ ref('stg_institution_classifications') }} c
    INNER JOIN {{ ref('stg_institutions') }} i
        ON c.inst_id = i.inst_id
    WHERE i.year = (SELECT max_year FROM latest_year)
)
SELECT
    ic.total AS total_institutions,
    cc.classified AS classified_institutions,
    ic.total - cc.classified AS missing,
    ROUND((ic.total - cc.classified)::numeric / NULLIF(ic.total, 0) * 100, 1) AS missing_pct
FROM institution_count ic, classified_count cc
WHERE (ic.total - cc.classified)::numeric / NULLIF(ic.total, 0) > 0.05
