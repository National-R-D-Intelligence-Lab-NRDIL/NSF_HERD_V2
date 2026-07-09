-- Field-level R&D breakdown as a share of each institution's total.
-- Parent fields only (top-level categories like Engineering, Life Sciences).
-- Sub-field drill-downs are served directly from stg_field_expenditures by the API.

WITH fields AS (
    SELECT * FROM {{ ref('stg_field_expenditures') }}
    WHERE is_parent = 1
),

institutions AS (
    SELECT inst_id, year, total_rd
    FROM {{ ref('stg_institutions') }}
)

SELECT
    f.inst_id,
    f.year,
    f.field_code,
    f.field_name,
    f.federal,
    f.nonfederal,
    f.total                                     AS field_total,
    i.total_rd                                  AS inst_total_rd,
    CASE
        WHEN i.total_rd > 0
        THEN ROUND(100.0 * f.total / i.total_rd, 2)
        ELSE 0
    END                                         AS field_share_pct
FROM fields f
JOIN institutions i
    ON f.inst_id = i.inst_id
   AND f.year    = i.year
