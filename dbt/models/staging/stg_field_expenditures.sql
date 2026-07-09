WITH source AS (
    SELECT * FROM {{ source('herd', 'raw_field_expenditures') }}
),

cleaned AS (
    SELECT
        inst_id,
        year,
        field_code,
        parent_field,
        is_parent,
        field_name,
        COALESCE(federal,    0) AS federal,
        COALESCE(nonfederal, 0) AS nonfederal,
        COALESCE(total,      0) AS total
    FROM source
    WHERE year BETWEEN 2010 AND 2024
      AND inst_id IS NOT NULL
      AND field_code IS NOT NULL
)

SELECT * FROM cleaned
