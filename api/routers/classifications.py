from fastapi import APIRouter, HTTPException, Request

from db import get_pool, rows_to_dicts

router = APIRouter(prefix="/classifications", tags=["classifications"])


@router.get("/options")
async def get_filter_options():
    """Return distinct values for each classification filter (populates dropdowns)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                ARRAY_AGG(DISTINCT carnegie_class ORDER BY carnegie_class) AS carnegie_classes,
                ARRAY_AGG(DISTINCT control ORDER BY control) AS controls
            FROM stg_institution_classifications
            WHERE carnegie_class IS NOT NULL
        """)
        counts = await conn.fetch("""
            SELECT
                COUNT(*) FILTER (WHERE has_med_school) AS med_school_count,
                COUNT(*) FILTER (WHERE is_aau) AS aau_count,
                COUNT(*) FILTER (WHERE is_aplu) AS aplu_count,
                COUNT(*) FILTER (WHERE is_hbcu) AS hbcu_count,
                COUNT(*) FILTER (WHERE is_hsi) AS hsi_count,
                COUNT(*) FILTER (WHERE is_epscor) AS epscor_count,
                COUNT(*) AS total
            FROM stg_institution_classifications
        """)

    row = dict(rows[0]) if rows else {}
    count_row = dict(counts[0]) if counts else {}

    return {
        "carnegie_classes": row.get("carnegie_classes") or [],
        "controls": row.get("controls") or [],
        "counts": {
            "total": count_row.get("total", 0),
            "med_school": count_row.get("med_school_count", 0),
            "aau": count_row.get("aau_count", 0),
            "aplu": count_row.get("aplu_count", 0),
            "hbcu": count_row.get("hbcu_count", 0),
            "hsi": count_row.get("hsi_count", 0),
            "epscor": count_row.get("epscor_count", 0),
        },
    }


@router.get("/{inst_id}")
async def get_classification(inst_id: str):
    """Return classification data for a single institution."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT inst_id, unitid, carnegie_class, control, has_med_school,
                   is_aau, is_aplu, is_hbcu, is_hsi, is_epscor
            FROM stg_institution_classifications
            WHERE inst_id = $1
        """, inst_id)

    if not row:
        raise HTTPException(status_code=404, detail=f"No classification data for institution '{inst_id}'")

    return dict(row)
