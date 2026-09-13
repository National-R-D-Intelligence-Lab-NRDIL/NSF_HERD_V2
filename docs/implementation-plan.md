# Implementation Plan: Auth, Multi-tenancy, Usage Metrics, Peer Movement

## Build Order (strict — each depends on the previous)

1. **Feature 1: Auth** — everything else requires user_id from a validated JWT
2. **Feature 4: Peer Movement** — independent, no auth dependency, delivers visible value fast
3. **Feature 2: Multi-tenancy** — requires auth (needs user_id)
4. **Feature 3: Usage Metrics** — requires auth + multi-tenancy (needs user_id + tenant_id)

---

## Feature 1: Authentication (Supabase Auth)

### New environment variables needed
Add to `.env`, `.env.example`, `docker-compose.yml`:
```
SUPABASE_JWT_SECRET=       # from Supabase dashboard → Settings → API → JWT Secret
NEXT_PUBLIC_SUPABASE_URL=  # same value as SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # same value as SUPABASE_ANON_KEY
```

### New packages
- API: add `python-jose[cryptography]==3.3.0` to `api/requirements.txt`
- Frontend: add `@supabase/supabase-js` and `@supabase/ssr` to `frontend/package.json`

### New files to create

**`api/auth.py`**
FastAPI dependency that validates the Supabase JWT. Extracts user_id. Raises 401 on failure. Uses python-jose to decode locally (no network call to Supabase per request).

**`frontend/lib/supabase.ts`**
Supabase client singleton using `createBrowserClient` from `@supabase/ssr` (cookie-based session so Next.js middleware can read it).

**`frontend/app/login/page.tsx`**
Email + password login form. Calls `supabase.auth.signInWithPassword`. On success, redirects to `/`.

**`frontend/middleware.ts`**
Next.js middleware. Reads session cookie on every request. Redirects to `/login` if no valid session. Exclude `/login` path from the redirect check.

### Files to modify

| File | Change |
|---|---|
| `api/config.py` | Add `supabase_jwt_secret: str = ""` to Settings |
| `api/main.py` | Add `allow_credentials=True` to CORS config |
| `api/routers/qa.py` | Add `user: dict = Depends(get_current_user)` to ask endpoint |
| `api/routers/briefing.py` | Same dependency |
| `api/routers/institutions.py` | Same for `/insight` and `/suggested-questions` endpoints only |
| `docker-compose.yml` | Add `SUPABASE_JWT_SECRET` to api service; add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to frontend service |
| `frontend/lib/api.ts` | Add `getAuthHeaders()` helper that reads Supabase session token. Apply to all fetch calls. |
| `frontend/app/page.tsx` | On mount, call `supabase.auth.getSession()`. Pass user to child components. |

### What NOT to protect
Do NOT add auth to `/institutions`, `/peers`, `/portfolio`, `/federal` data endpoints. Institution picker loads on mount before auth state resolves — protecting these would break the app. Only protect LLM-backed endpoints (qa, briefing, insight, suggested-questions).

### Verify
```bash
# Unauthenticated browser → should redirect to /login
curl -I http://localhost:3000/

# API call without token → should return 401
curl -X POST http://localhost:8000/qa/ask -H "Content-Type: application/json" -d '{"question":"test"}'
```

---

## Feature 4: Peer Movement (build this second — independent of auth)

### No new packages needed

### New files to create
None. Add to existing files only.

### Files to modify

**`api/routers/peers.py`** — Add new endpoint:
```
GET /peers/{inst_id}/movement?start=2019&end=2024
```

Endpoint logic:
1. Resolve peer IDs from KNN (same as `get_gap` already does)
2. Run live SQL against `mart_rankings` for movement stats (rank delta, CAGR, dollar gap vs target)
3. Run second SQL against `stg_field_expenditures` (is_parent=1) for top 3 growing fields per peer
4. Return combined JSON

Do NOT query `mart_peer_movement` directly for parameterized queries — that table has start/end year baked in at dbt build time. Run the equivalent SQL live.

Response shape:
```json
{
  "inst_id": "003594",
  "window": { "start": 2019, "end": 2024 },
  "peers": [
    {
      "inst_id": "...",
      "name": "Texas State University",
      "rank_current": 189,
      "rank_prior": 212,
      "rank_delta": -23,
      "total_rd_current": 145000000,
      "cagr_pct": 5.3,
      "is_converging": true,
      "dollar_gap": -8000000,
      "top_growing_fields": [
        { "field_name": "Engineering, all", "cagr_pct": 14.2 }
      ]
    }
  ]
}
```

`dollar_gap` = peer total_rd_current minus target total_rd_current (negative = peer is behind)
`is_converging` = peer rank improved AND peer CAGR > target CAGR

SQL for movement stats:
```sql
WITH peer_ranks AS (
    SELECT inst_id, MAX(name) AS name,
        MAX(CASE WHEN year = $end THEN national_rank END) AS rank_current,
        MAX(CASE WHEN year = $start THEN national_rank END) AS rank_prior,
        MAX(CASE WHEN year = $end THEN total_rd END) AS total_rd_current,
        MAX(CASE WHEN year = $start THEN total_rd END) AS total_rd_prior
    FROM mart_rankings
    WHERE inst_id = ANY($peer_ids) AND year IN ($start, $end)
    GROUP BY inst_id
)
SELECT *,
    rank_current - rank_prior AS rank_delta,
    total_rd_current - $target_total_rd AS dollar_gap,
    ROUND((POWER(total_rd_current * 1.0 / NULLIF(total_rd_prior, 0),
        1.0 / ($end - $start)) - 1) * 100, 1) AS cagr_pct
FROM peer_ranks
WHERE rank_current IS NOT NULL AND rank_prior IS NOT NULL
ORDER BY rank_delta ASC;
```

**`frontend/lib/api.ts`** — Add `getPeerMovement(instId, start, end)` function

**`frontend/lib/types.ts`** — Add `PeerMovementRow` and `PeerMovementResponse` interfaces

**`frontend/components/SnapshotTab.tsx`** — Add "Movement" as a third sub-tab in `PeerAnalysisSubTabs` (alongside existing "Funding Profile" and "Growth Over Time"). Fetch lazily — only when user clicks the sub-tab.

Movement sub-tab renders a table (not a chart). One row per peer:
- Institution name
- Rank change: "#212 → #189" with colored delta badge (green = improved)
- CAGR %
- Dollar gap: "+$8M ahead" or "-$12M behind" relative to target
- Fastest growing field + that field's CAGR
- "Closing in" badge if `is_converging = true`

Sort order: converging peers first, then by rank_delta ascending (most improved first).

### Verify
```bash
curl "http://localhost:8000/peers/003594/movement?start=2019&end=2024"
# Should return JSON with peers array
```

---

## Feature 2: Multi-tenancy

### Prerequisite: Feature 1 (auth) must be working

### Database schema — add to `scripts/seed.sql`
```sql
CREATE TABLE IF NOT EXISTS tenants (
    tenant_id   TEXT PRIMARY KEY,   -- HERD inst_id e.g. '003594'
    name        TEXT NOT NULL,
    active      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id    TEXT PRIMARY KEY,    -- Supabase auth UUID
    email      TEXT NOT NULL,
    tenant_id  TEXT REFERENCES tenants(tenant_id),
    role       TEXT DEFAULT 'viewer',  -- 'viewer' | 'admin'
    created_at TIMESTAMP DEFAULT NOW()
);
```

Apply to running Postgres immediately (don't wait for fresh volume):
```bash
docker compose exec postgres psql -U herd -d herd_db -c "
CREATE TABLE IF NOT EXISTS tenants (...);
CREATE TABLE IF NOT EXISTS user_profiles (...);"
```

### New files to create

**`api/routers/users.py`**
```
GET  /users/me              → { user_id, email, tenant_id, role }  (auth required)
POST /users/me/profile      → body: { tenant_id } → 200 OK         (auth required)
GET  /admin/tenants         → [{ tenant_id, name, user_count }]    (admin role only)
```

### Files to modify

| File | Change |
|---|---|
| `api/auth.py` | After validating JWT, fetch user profile from `user_profiles` table. Return `{ user_id, email, tenant_id, role }`. If no profile row exists, return `{ user_id, email, tenant_id: None, role: None }`. |
| `api/main.py` | `app.include_router(users.router)` |
| `scripts/seed.sql` | Add both CREATE TABLE statements |
| `frontend/lib/api.ts` | Add `getUserProfile()` and `updateUserProfile(tenant_id)` functions |
| `frontend/app/page.tsx` | On mount (after getSession), call `getUserProfile()`. If `tenant_id` is null → show onboarding overlay (institution picker modal). On institution select → call `updateUserProfile(inst_id)` → dismiss modal and continue. |

### Onboarding overlay
Not a new page — a conditional `<div>` overlay rendered in `page.tsx` when `!profile?.tenant_id`. Reuse the existing `InstitutionPicker` component. One button: "Set as my institution." After save, set profile in state and hide the overlay.

### Verify
```bash
# New user: no profile
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/users/me
# → { user_id: "...", email: "...", tenant_id: null, role: null }

# Set institution
curl -X POST http://localhost:8000/users/me/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "003594"}'
# → 200 OK

# Confirm
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/users/me
# → { ..., tenant_id: "003594", role: "viewer" }
```

---

## Feature 3: Usage Metrics

### Prerequisite: Features 1 and 2 must be working (need user_id + tenant_id)

### Database schema — add to `scripts/seed.sql`
```sql
CREATE TABLE IF NOT EXISTS usage_events (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT,
    tenant_id       TEXT,
    event_type      TEXT NOT NULL,
    institution_id  TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_event_type ON usage_events(event_type);
CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC);
```

### Event types and metadata
| event_type | metadata |
|---|---|
| `qa_query` | `{ question: str, institution_id: str }` |
| `briefing_export` | `{ institution_id: str, peer_mode: str }` |
| `institution_view` | (none — institution_id column carries it) |
| `tab_view` | `{ tab: str }` — tab name |
| `peer_compare` | `{ peer_count: int, peer_mode: str }` |

### New files to create

**`api/services/usage_logger.py`**
```python
async def log_event(pool, *, event_type, user_id=None, tenant_id=None,
                    institution_id=None, metadata=None):
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO usage_events "
                "(user_id, tenant_id, event_type, institution_id, metadata) "
                "VALUES ($1, $2, $3, $4, $5)",
                user_id, tenant_id, event_type, institution_id,
                json.dumps(metadata) if metadata else None,
            )
    except Exception:
        pass  # never crash the app on a logging failure
```

**`api/routers/admin.py`** (or add to existing users.py)
```
POST /usage/log     → body: { event_type, institution_id, metadata } → 204  (auth required, any role)
GET  /admin/usage   → query params: limit, event_type, tenant_id → rows  (admin role only)
```

### Files to modify

| File | Change |
|---|---|
| `scripts/seed.sql` | Add usage_events table + indexes |
| `api/routers/qa.py` | After returning response: `asyncio.create_task(log_event(pool, event_type="qa_query", user_id=user["user_id"], tenant_id=user["tenant_id"], institution_id=body.inst_id, metadata={"question": body.question}))` |
| `api/routers/briefing.py` | Same pattern, `event_type="briefing_export"` |
| `api/main.py` | Include admin router |
| `frontend/lib/api.ts` | Add `logEvent(eventType, institutionId, metadata)` — POSTs to `/usage/log`. Entire function wrapped in try/catch, never throws. |
| `frontend/app/page.tsx` | Call `logEvent("institution_view", inst.inst_id)` in `handleSelect`. Call `logEvent("tab_view", selected?.inst_id, { tab: activeTab })` in `setActiveTab`. |

### Verify
```bash
# Use the app: select an institution, switch tabs, ask a QA question

# Check events landed
docker compose exec postgres psql -U herd -d herd_db \
  -c "SELECT event_type, institution_id, metadata, created_at FROM usage_events ORDER BY created_at DESC LIMIT 20;"

# Admin endpoint
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8000/admin/usage?limit=10&event_type=qa_query"
```

---

## Cross-cutting notes for implementation

**Docker rebuilds required:**
- After adding packages to `api/requirements.txt`: `docker compose build api`
- After adding packages to `frontend/package.json`: `docker compose build frontend`
- After adding new env vars: `docker compose up -d` (picks up .env changes without rebuild)

**Schema changes on a running Postgres (don't wipe volume):**
Run DDL directly via psql instead of waiting for a fresh volume start:
```bash
docker compose exec postgres psql -U herd -d herd_db
```
Then paste the CREATE TABLE statements.

**Supabase session in Next.js middleware:**
Use `@supabase/ssr` package, not `@supabase/supabase-js` directly, for the middleware client. The middleware runs on the Edge Runtime which cannot access localStorage. `@supabase/ssr` handles cookie-based sessions that middleware can read. If this gets complicated, fall back to client-side auth check in `page.tsx` (simpler, acceptable for this app).

**Fire-and-forget logging rule (from CLAUDE.md):**
Every logging call — both in the API and in the frontend — must be wrapped so that a logging failure never crashes the app, never returns an error to the user, and never blocks the main response. This is non-negotiable.
