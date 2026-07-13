-- Cleaned institution classification data.
-- One row per institution with Carnegie class, control, membership flags.
-- Materialized as a view (small table, rarely changes).

WITH classifications AS (
    SELECT
        inst_id,
        unitid,
        COALESCE(carnegie_class, 'Unknown') AS carnegie_class,
        COALESCE(control, 'Unknown') AS control,
        COALESCE(has_med_school, FALSE) AS has_med_school,
        COALESCE(is_aau, FALSE) AS is_aau,
        COALESCE(is_aplu, FALSE) AS is_aplu,
        COALESCE(is_hbcu, FALSE) AS is_hbcu,
        COALESCE(is_hsi, FALSE) AS is_hsi,
        COALESCE(is_epscor, FALSE) AS is_epscor
    FROM {{ source('herd', 'raw_institution_classifications') }}
)

SELECT * FROM classifications
