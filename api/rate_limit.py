"""In-memory per-user rate limiting.

The API runs as a single container (see docker-compose.yml -- one `api`
service, no replicas), so an in-process counter is enough; it would need
to move to something shared (e.g. Redis) if the API is ever scaled
horizontally.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException

_requests: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(key: str, max_requests: int, window_seconds: int) -> None:
    """Raise 429 if `key` has made >= max_requests in the trailing window."""
    now = time.monotonic()
    bucket = _requests[key]
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= max_requests:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: max {max_requests} requests per {window_seconds // 60} minutes",
        )
    bucket.append(now)
