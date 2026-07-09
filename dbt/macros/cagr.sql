{% macro cagr(start_value, end_value, years) %}
    CASE
        WHEN {{ start_value }} > 0
         AND {{ years }} > 0
         AND {{ end_value }} IS NOT NULL
         AND {{ start_value }} IS NOT NULL
        THEN ROUND(
            (
                (
                    POWER(
                        CAST({{ end_value }} AS FLOAT) / CAST({{ start_value }} AS FLOAT),
                        1.0 / {{ years }}
                    ) - 1
                ) * 100
            )::NUMERIC,
            2
        )
        ELSE NULL
    END
{% endmacro %}
