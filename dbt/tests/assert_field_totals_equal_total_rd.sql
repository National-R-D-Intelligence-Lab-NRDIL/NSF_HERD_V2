-- Invariant: sum of parent field totals must equal total_rd for each inst/year.
-- Returns rows that violate the invariant. Test passes when 0 rows are returned.
--
-- Tolerance: $1000 (rounding from thousands-to-dollars conversion in the ETL)

SELECT
    i.inst_id,
    i.year,
    i.total_rd,
    COALESCE(SUM(f.total), 0) AS field_sum,
    ABS(i.total_rd - COALESCE(SUM(f.total), 0)) AS discrepancy
FROM {{ ref('stg_institutions') }} i
LEFT JOIN {{ ref('stg_field_expenditures') }} f
    ON  f.inst_id   = i.inst_id
    AND f.year      = i.year
    AND f.is_parent = 1
GROUP BY i.inst_id, i.year, i.total_rd
HAVING ABS(i.total_rd - COALESCE(SUM(f.total), 0)) > 1000
