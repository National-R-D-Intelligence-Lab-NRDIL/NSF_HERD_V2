WITH source AS (
    SELECT * FROM {{ source('herd', 'raw_agency_funding') }}
),

cleaned AS (
    SELECT
        inst_id,
        year,
        agency_code,
        agency_name,
        COALESCE(amount, 0) AS amount
    FROM source
    WHERE year BETWEEN 2010 AND 2024
      AND inst_id IS NOT NULL
      AND agency_code IS NOT NULL
)

SELECT * FROM cleaned
