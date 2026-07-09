from decimal import Decimal

import asyncpg
from config import settings

# Module-level pool, created on FastAPI startup and closed on shutdown.
# All routers import `get_pool()` rather than opening their own connections.
_pool: asyncpg.Pool | None = None


async def connect_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        user=settings.postgres_user,
        password=settings.postgres_password,
        database=settings.postgres_db,
        host=settings.postgres_host,
        port=settings.postgres_port,
        min_size=2,
        max_size=10,
    )


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Did startup run?")
    return _pool


def rows_to_dicts(rows: list[asyncpg.Record]) -> list[dict]:
    """Convert asyncpg records to plain dicts, casting NUMERIC (Decimal)
    columns to float so FastAPI's default JSON encoder handles them."""
    return [
        {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(r).items()}
        for r in rows
    ]
