-- Invariant: sum of agency amounts must equal total federal funding for each inst/year.
-- Returns rows that violate the invariant. Test passes when 0 rows are returned.
--
-- Tolerance: $1000 (rounding from thousands-to-dollars conversion in the ETL)

SELECT
    i.inst_id,
    i.year,
    i.federal,
    COALESCE(SUM(a.amount), 0) AS agency_sum,
    ABS(i.federal - COALESCE(SUM(a.amount), 0)) AS discrepancy
FROM {{ ref('stg_institutions') }} i
LEFT JOIN {{ ref('stg_agency_funding') }} a
    ON  a.inst_id = i.inst_id
    AND a.year    = i.year
GROUP BY i.inst_id, i.year, i.federal
HAVING ABS(i.federal - COALESCE(SUM(a.amount), 0)) > 1000
