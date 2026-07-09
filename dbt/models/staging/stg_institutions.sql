WITH source AS (
    SELECT * FROM {{ source('herd', 'raw_institutions') }}
),

cleaned AS (
    SELECT
        inst_id,
        name,
        city,
        state,
        year,
        -- Null-safe: NSF occasionally leaves source fields blank; treat as $0
        COALESCE(total_rd,      0) AS total_rd,
        COALESCE(federal,       0) AS federal,
        COALESCE(state_local,   0) AS state_local,
        COALESCE(business,      0) AS business,
        COALESCE(nonprofit,     0) AS nonprofit,
        COALESCE(institutional, 0) AS institutional,
        COALESCE(other_sources, 0) AS other_sources
    FROM source
    WHERE year BETWEEN 2010 AND 2024
      AND inst_id IS NOT NULL
)

SELECT * FROM cleaned
