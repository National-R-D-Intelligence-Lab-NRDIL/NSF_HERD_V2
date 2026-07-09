-- Invariant: for fields that have sub-fields, sum of sub-field totals must equal parent total.
-- Standalone parents (cs, math, psychology, other_sciences) are excluded —
-- the survey doesn't break them into sub-disciplines.
-- Returns rows that violate the invariant. Test passes when 0 rows are returned.

WITH parents_with_subfields AS (
    -- Only check parents that actually have sub-fields in this dataset
    SELECT DISTINCT parent_field
    FROM {{ ref('stg_field_expenditures') }}
    WHERE is_parent = 0
),

sub_sums AS (
    SELECT
        inst_id,
        year,
        parent_field,
        SUM(total) AS sub_total
    FROM {{ ref('stg_field_expenditures') }}
    WHERE is_parent = 0
    GROUP BY inst_id, year, parent_field
),

parent_totals AS (
    SELECT
        inst_id,
        year,
        field_code,
        total AS parent_total
    FROM {{ ref('stg_field_expenditures') }}
    WHERE is_parent = 1
      AND field_code IN (SELECT parent_field FROM parents_with_subfields)
)

SELECT
    p.inst_id,
    p.year,
    p.field_code,
    p.parent_total,
    COALESCE(s.sub_total, 0)                          AS sub_total,
    ABS(p.parent_total - COALESCE(s.sub_total, 0))    AS discrepancy
FROM parent_totals p
LEFT JOIN sub_sums s
    ON  s.inst_id      = p.inst_id
    AND s.year         = p.year
    AND s.parent_field = p.field_code
WHERE ABS(p.parent_total - COALESCE(s.sub_total, 0)) > 1000
