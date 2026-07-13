# NSF HERD v2 — Project Context Log

> Append-only. Each entry records what was built, why, and key decisions made. Source for future docs, articles, and diagrams.

---

## [Phase 1] Docker + Postgres Foundation — 2026-06-27

### What was built
- `docker-compose.yml` — runs Postgres in a container; one command starts the database
- `.env.example` — template for all environment variables (passwords, API keys)
- `scripts/seed.sql` — SQL that creates the 3 raw tables on first startup
- `scripts/load_seed_data.py` — migrates data from v1 SQLite into Postgres

### Why
v1 used SQLite (a file on disk). Moving to Postgres makes the database a proper server that the API, dbt, and DuckDB can all connect to simultaneously. Docker means any machine can run the exact same setup with one command — no manual Postgres installation.

### Key decisions
- **`raw_` table prefix** — raw tables are never modified after loading. dbt staging models read from them. Keeps the layers clean.
- **Named volume `pgdata`** — data persists when the container restarts. Without it, every restart wipes the database.
- **`seed.sql` via initdb.d** — Postgres auto-runs scripts in that folder on first start. Tables are created before any data is loaded.
- **Batch inserts + `ON CONFLICT DO NOTHING`** — loads ~298K rows efficiently and is safe to re-run without erroring on duplicates.

### Alternatives rejected
- Local Postgres install: works, but not reproducible across machines
- Neon (managed cloud): CLAUDE.md explicitly ruled it out — cold starts and 0.5GB limit

### Open questions
- Need to create `.gitignore` to exclude `.env` before first commit
- `load_seed_data.py` default path assumes `nsf-herd-mvp` sits next to `nsf-herd-v2` — may need `--sqlite` flag if folder structure differs

### Known shortcut (to revisit in Phase 5)
Phase 1 skipped the download step entirely. Instead of pulling fresh data from the NSF website, we copied already-transformed data from v1's `herd.db` SQLite file directly into Postgres. This was intentional — fastest way to get a working database for Phases 2–4. The proper ingestion pipeline (dlt + Dagster) replaces this in Phase 5.

---

## [Phase 2] dbt Core — 2026-06-28

### What was built
- `dbt/Dockerfile` — runs dbt inside Docker, nothing installed on the local machine
- `dbt/dbt_project.yml` — project config, materialization settings, default year window (2019–2024)
- `dbt/profiles.yml` — Postgres connection via environment variables
- `dbt/macros/cagr.sql` — reusable CAGR formula used across mart models
- `dbt/models/staging/` — 3 staging views (stg_institutions, stg_field_expenditures, stg_agency_funding)
- `dbt/models/marts/` — 5 mart tables (rankings, peer metrics, field portfolio, peer movement, trajectories)
- `dbt/models/staging/_staging.yml` — source definitions + column-level tests
- `dbt/models/marts/_marts.yml` — mart schema + tests
- `dbt/tests/assert_*.sql` — 3 custom data invariant tests

### Why
The 6 Python ETL scripts in v1 had no tests, no documentation, and no dependency tracking. Replacing them with dbt models means every transformation is tested automatically, the dependency order is inferred from `ref()` calls, and the entire layer rebuilds from one command.

### Key decisions
- **Staging as views, marts as tables** — staging views are cheap and always fresh. Mart tables are pre-computed once at `dbt run` time so the API doesn't re-rank 10,000 institutions on every request.
- **`ref()` over raw table names** — enforces dependency tracking. dbt infers the execution order automatically from these calls.
- **`source()` for raw tables** — distinguishes raw data (owned by ingestion) from models (owned by dbt). Enables freshness checks later.
- **Pin both `dbt-core` and `dbt-postgres`** — leaving pip to resolve versions pulled in `dbt-core 2.0.0a2` which dropped Postgres support. Explicit pinning to `1.8.2` is required.
- **CAGR as a macro** — used in 3 mart models. One place to change the formula if needed.

### Alternatives rejected
- Single large SQL view per dashboard (the traditional BI approach) — works but untestable at intermediate steps and breaks silently when upstream changes
- Python for transformations — dbt in SQL is simpler, faster, and keeps all transformation logic in one layer

### Bugs hit
- `dbt-postgres==1.8.2` pulled in `dbt-core 2.0.0a2` automatically — that version dropped Postgres support. Fixed by pinning `dbt-core==1.8.2` explicitly.
- `ROUND(double precision, int)` doesn't exist in Postgres — `POWER()` returns float, must cast to `::NUMERIC` before `ROUND()`. Fixed in the CAGR macro.
- `HAVING` without `GROUP BY` in `assert_subfield_sums_equal_parent.sql` — should be `WHERE`. Fixed.

### Open questions
- The `tests` key in YAML is deprecated in dbt 1.8 — should be `data_tests`. Works but generates a warning. Will clean up before Phase 6 CI setup.
- Ingestion layer (downloading from NSF website) is still a shortcut — v1's `herd.db` data was copied directly. Proper dlt pipeline replaces this in Phase 5.

### Results
- 8 models built (3 staging views + 5 mart tables)
- 40 tests: 40 pass, 0 fail
- All 3 data invariants confirmed clean across all 10,084 institution/year combinations

---

## [Phase 3] FastAPI (partial) — 2026-07-07

### What was built
- `api/Dockerfile`, `api/requirements.txt` — FastAPI service, containerized
- `api/main.py` — app factory, CORS, lifespan hook (opens/closes the Postgres pool, fits the KNN benchmarker once at startup)
- `api/config.py` — env var loading via pydantic-settings
- `api/db.py` — asyncpg connection pool + `rows_to_dicts()` helper (casts NUMERIC/Decimal columns to float for JSON)
- `api/services/benchmarker.py` — KNN peer-matching, ported from v1 `src/benchmarker.py`; data now loads from Postgres (`stg_institutions`) instead of SQLite
- `api/routers/institutions.py` — list, detail, rank trend, anchor (competitive band), funding breakdown, state rank
- `api/routers/peers.py` — KNN peer IDs, gap analysis, historical peer trend
- `api/routers/portfolio.py` — field portfolio, sub-field drilldown, field momentum (CAGR)
- `api/routers/federal.py` — agency breakdown, trend, HHI concentration score
- `api/routers/qa.py` — natural language Q&A, ported from v1 `src/query_engine.py`'s `ask()`/`generate_sql()`/`summarize_results()` pipeline (Gemini generates SQL → executes read-only → Gemini summarizes)
- `docker-compose.yml` — added `api` service (port 8000, live-mounted code, depends on healthy Postgres)

**Not yet built (deferred by explicit scope decision):** `scenarios`, `projections`, `briefing` routers/services. Institutions/peers/portfolio/federal/qa form the verified foundation; the new decision-engine features will be layered on top of these later.

### Why
Every query the old Streamlit app made directly against SQLite is now an HTTP endpoint, decoupling data access from any particular frontend. This is also the first layer where the Phase 2 dbt investment pays off directly: mart tables already precomputed ranks, CAGRs, and field shares, so most routers are thin `SELECT ... WHERE inst_id = $1` calls instead of re-deriving window functions per request like v1 did.

### Key decisions
- **Routers read from dbt marts, not staging** — `mart_rankings`, `mart_field_portfolio` etc. already have `RANK()`/CAGR precomputed. Only funding breakdown and agency detail (which need raw dollar columns, not just precomputed shares) hit `stg_*` views directly.
- **Benchmarker fitted once at FastAPI startup, stored on `app.state`** — matches CLAUDE.md's "cache reads, never writes" rule. All peer-lookup requests reuse the same fitted KNN model instead of refitting per request (v1 relied on Streamlit's `@st.cache_resource` for the same effect).
- **asyncpg pool built from keyword args, not a DSN string** — same fix as the Phase 1 `load_seed_data.py` bug: the Postgres password contains `@`, which breaks URL-style connection strings. Kept the fix consistent across the codebase.
- **QA schema prompt points at `stg_*` views** — keeps the LLM's SQL flexible (ad hoc questions, not just precomputed marts) while staying consistent with dbt's staging layer naming.
- **CAGR in hand-written/LLM SQL uses the `value * 1.0` trick, not explicit `::FLOAT` casts** — in Postgres, `1.0` is a NUMERIC literal, so `POWER(x * 1.0 / y, ...)` returns NUMERIC and `ROUND()` works directly. The dbt CAGR macro (Phase 2) broke because it explicitly cast to `FLOAT` first; this was avoided here by not doing that.
- **`time.sleep()` swapped for `await asyncio.sleep()`** in the Gemini retry backoff — a blocking call inside an `async def` would freeze the entire event loop, not just one request.
- **QA endpoint returns `503` (not a crash) when `GEMINI_API_KEY` is unset** — the API stays usable for every other router even without an LLM key configured.

### Alternatives rejected
- Recomputing ranks/CAGR in Python inside the API layer (matching v1's approach) — rejected because dbt already computed and materialized these; recomputing would duplicate logic and drift from the tested dbt models.
- Synchronous psycopg2 (matching v1/Phase 1 scripts) — rejected in favor of asyncpg + connection pooling, since FastAPI is async end-to-end and CLAUDE.md requires "no blocking operations in API handlers."
- Building `scenarios`/`projections`/`briefing` alongside the rest of Phase 3 — explicitly deferred at the user's request to keep the phase scoped and verifiable in smaller steps.

### Open questions
- `/qa/ask` has no rate limiting yet (v1 had 50/hour per user) — blocked on an auth layer that doesn't exist yet in v2.
- Gemini API key was copied directly from `nsf-herd-mvp/.env` into `nsf-herd-v2/.env` for convenience — fine for local dev, should be rotated/secured before any real deployment.
- DuckDB (Phase 4) not yet wired in; all analytical queries currently run on Postgres directly, which is fine at current data volume (~300K rows) but scenarios/projections may want DuckDB's speed later.
- `scenarios`, `projections`, `briefing` endpoints remain unbuilt — next planned work.

### Results
- 5 routers live: institutions, peers, portfolio, federal, qa
- Verified against real data: UNT (`inst_id=003594`) rank trend, anchor view, peer gap, field momentum, agency concentration, and two natural-language QA queries (including one with session context) all returned correct results
- `/docs` (Swagger UI) confirmed working

## [Phase 7] Frontend stack reaffirmed — 2026-07-07

### What was built
No new code — a decision checkpoint. Phase 7 (Next.js frontend) was already built and locally verified against all 5 API routers before this checkpoint. Full v1 UI inventory (every widget, chart, and custom-styled element in `app.py`) was catalogued and compared against the new frontend to find visual/feature gaps.

### Why
The frontend was originally started as Next.js/TypeScript without asking which of CLAUDE.md's two Phase 7 options (Reflex vs. React+Next.js) was actually wanted. Once the user pointed out they can't read or write TypeScript, this became a real decision, not just an implementation detail: continuing with a stack the project owner can't maintain independently is a legitimate long-term risk.

### Key decisions
- **Keep Next.js/React**, not Reflex, not "polish v1 Streamlit instead." Reasoning given to the user: the app already works end-to-end, matches CLAUDE.md's "production standard" framing, and has the highest visual/portfolio ceiling.
- **Trade-off accepted explicitly**: the user will not be able to independently maintain this layer without learning TypeScript/React basics. To offset that, `docs/learning.md` now includes a plain-language primer on the exact patterns used in this codebase (not generic React tutorials), so future changes are legible even if written by Claude.
- Clarified a misconception during the discussion: the original reason for choosing a JS frontend was **not** that Streamlit can't support multiple users — v1 already does that via Supabase auth. The actual reason was CLAUDE.md's explicit Phase 7 framing of React as the "production standard" learning goal.

### Alternatives rejected
- **Reflex** — pure Python, would let the user read/edit the frontend directly, but throws away the fully-built and verified Next.js app and is explicitly framed in CLAUDE.md as lower resume value.
- **Drop the frontend rewrite, polish v1 Streamlit instead** — fastest path to a demoable app with zero new language to learn, but abandons the Postgres/dbt/FastAPI backend work already built in Phases 1–3 (v1 still reads from SQLite).

### Open questions
- How much TypeScript/React the user wants to actually learn vs. treat as a black box is still open — `docs/learning.md` primer is a starting point, not a finished curriculum.
- Visual gap-closing work identified in the v1 UI inventory (landing briefing, sidebar, custom peer selection, peer-analysis sub-tabs, state competitive position, chart PNG export, etc.) is not yet scheduled.

### Scope decision — Phase 3 closed as-is (2026-07-07)
Explicit call: institutions, peers, portfolio, federal, and qa cover the full v2 MVP feature set (institutional snapshot, research portfolio, federal landscape, ask-a-question). `scenarios`, `projections`, and `briefing` (CLAUDE.md's Features 1, 3, 4) are **deliberately deferred** — not abandoned, not forgotten. They will be revisited after the frontend makes the current feature set demoable end-to-end. Reasoning: shipping a usable product (API + UI) beats adding more backend surface area no one can see yet. Revisit trigger: once frontend (Phase 7) is live and validated, return to this list before considering the platform "done."

## [Phase 7] Frontend v1-parity build-out — 2026-07-07

### What was built
Three rounds of frontend work bringing the Next.js app to (and past) v1 feature parity:

1. **Institution Snapshot tab** — full rebuild: searchable institution picker, custom peer selector, landing KPIs, LLM strategic insight, rank/anchor bar charts, peer-analysis sub-tabs, funding source analysis. Two bugs fixed: `CustomPeerSelector` was silently capping results at 50 with no indication more existed (removed the `.slice(0, 50)`); the State Competitive Position table showed every in-state institution instead of the top 10 (added `.slice(0, 10)`, retitled the card `Top 10 in {state}`).
2. **Research Portfolio / Federal Landscape tabs** — full rebuild to match v1's exact section order and logic: stacked federal/nonfederal portfolio bars, field-momentum quadrant scatter (median reference lines standing in for Plotly's floating annotations), fastest-growing/largest/most-federal callouts, all-fields sub-field drill-down expanders, portfolio distinctiveness diverging bar. Federal side: donut + table agency breakdown, 3-KPI diversification card, per-agency-colored funding trend line chart, agency growth summary expander, agency distinctiveness diverging bar. Required two new backend endpoints that didn't exist yet: `GET /portfolio/{inst_id}/peer-comparison` and `GET /federal/{inst_id}/peer-comparison`, both following the existing custom-peer-or-KNN resolution pattern from `peers.py`.
3. **Ask tab — dynamic per-institution suggested questions (new, beyond v1 parity)** — v1's suggested questions are static templates (same 9 questions for every school, only the state name swapped in). Built a new rule-based `GET /institutions/{inst_id}/suggested-questions` endpoint that computes real per-institution markers — nearest-ranked peer, top field, fastest-growing field (CAGR > 0), top federal agency, and the field/agency where the institution's peer-relative share is most distinctive (reusing the peer-comparison SQL pattern from the Portfolio/Federal work) — and generates 3 grouped, genuinely different questions per institution. Wired into `QaTab.tsx`, replacing the old static 4-question array.

### Why
The user asked for exact v1 fidelity on Portfolio/Federal, then asked whether the Ask tab could go a step further than v1 and actually reason about the specific institution rather than reusing the same question list for everyone. Since v1 itself doesn't do this, it was treated as new scope rather than a port.

### Key decisions
- **Suggested questions are rule-based SQL, not LLM-generated** — deterministic, no added latency/cost, and the question text is built directly from the same data the rest of the dashboard already shows, so it can't hallucinate a fact the user can't verify on-screen.
- **Reused the peer-comparison pattern three times** (Portfolio, Federal, and now the suggested-questions "distinctiveness" markers) instead of writing three different aggregation strategies — kept as near-identical SQL shapes across `portfolio.py`, `federal.py`, and `institutions.py`.
- **Quadrant labels via `ReferenceLine` + `Label` children** instead of free-floating Plotly-style annotations — Recharts has no direct equivalent; anchoring labels to the median reference lines was the closest approximation and was explicitly flagged as a trade-off.

### Alternatives rejected
- LLM-generated suggested questions (e.g., asking Gemini to look at the institution's data and propose questions) — rejected for latency/cost on every institution switch, and because the rule-based approach already produces concrete, grounded questions with no risk of inventing a fact.

### Bugs hit
- Field names in two of the six suggested-question templates rendered with a raw `", all"` suffix (e.g. "Engineering, all") — the `.replace(", all", "")` cleanup used elsewhere (e.g. the `/insight` endpoint) was missed in the new fastest-field/distinctive-field templates. Fixed.
- The `api` container has no `--reload` and the compose file only live-mounts the code — edits to `.py` files don't take effect until `docker compose restart api`. This was the actual cause of the Portfolio/Federal peer-comparison endpoints appearing to 404 after being "built" in the prior session; they were never actually live until this session's restart. Worth remembering for every future backend change.
- Clicking a suggested peer-comparison question surfaced a pre-existing gap in `/qa/ask`'s NL-to-SQL prompt: Gemini's generated SQL does `name LIKE '%University of Pennsylvania%' LIMIT 1` with no `ORDER BY`, which also matches "East Stroudsburg University of Pennsylvania" etc. and non-deterministically picks the wrong school. Not fixed yet — logged as an open question below.

### Open questions
- `/qa/ask`'s name-matching SQL needs tightening (exact match preferred, `LIKE` as fallback, or resolve peer names to `inst_id` server-side before handing off to Gemini) so peer-comparison questions reliably compare against the right institution.
- Nothing from this session (or the two frontend rebuild rounds before it) is committed to git yet — `api/`, `dbt/`, `docker-compose.yml`, `docs/`, `frontend/`, and `scripts/` are all still untracked. Still just one commit in the repo ("Initial commit: add project document and build plan").
- `scenarios`, `projections`, and `briefing` (CLAUDE.md Features 1, 3, 4) remain deferred, per the Phase 3 scope decision above.

### Results
- Clean `npm run build` (zero TypeScript errors) after each of the three rounds.
- Both new peer-comparison endpoints and the new suggested-questions endpoint verified against live data (Johns Hopkins `029977`, UNT `003594`) after restarting the API container — confirmed genuinely different markers/questions per institution.

---

## [Feature 5] Peer Benchmarking Classification Filters — 2026-07-11

### What was built
- New Postgres table `raw_institution_classifications` — stores Carnegie class, public/private control, medical school flag, and membership booleans (AAU, APLU, HBCU, HSI, EPSCoR)
- dbt seed CSVs: `seed_aau_members.csv`, `seed_aplu_members.csv`, `seed_epscor_states.csv`
- Bootstrap script `scripts/load_classifications.py` — heuristically assigns Carnegie class from R&D thresholds, detects medical schools via life_sciences dominance (>60%), and merges membership lists
- dbt staging model `stg_institution_classifications.sql` with schema tests and accepted_values constraints
- dbt coverage test `assert_classification_coverage.sql` — warns if >5% of institutions lack classification data
- Extended `AutoBenchmarker` with filtered peer matching — when filters are provided, bypasses pre-fitted KD-tree and uses brute-force `scipy.cdist` on the masked subset (sub-millisecond for ~1,000 institutions)
- Updated `/peers/{inst_id}` (and `/gap`, `/trend`) with optional filter query params: `carnegie`, `control`, `exclude_med`, `aau_only`, `aplu_only`, `hbcu_only`, `hsi_only`, `epscor_only`
- New router `api/routers/classifications.py` — `GET /classifications/{inst_id}` and `GET /classifications/options`
- Response now includes `candidate_pool_size` (total and filtered count)
- Frontend `PeerFilterPanel.tsx` — collapsible filter panel with Carnegie multi-select, control toggle, med school exclusion, and membership checkboxes; shows pool size badge

### Why
Medical-heavy institutions (Johns Hopkins, UCSF) were appearing as peers for comprehensive universities because KNN matches on funding size alone. A $180M comprehensive university matched with a $180M clinical-trials-only institution — not meaningful peers. Classification filters let users narrow the candidate pool before distance computation.

### Key decisions
- **Single wide table, not normalized** — ~1,000 rows, 10 columns. No need for join tables for boolean flags.
- **Brute-force over pre-fitted trees** — With 1,004 institutions and 7 features, cdist on a filtered subset is sub-millisecond. No need to maintain multiple KD-trees per filter combination.
- **Backward compatible** — No filters = same KNN results as before. Existing API consumers unaffected.
- **Heuristic bootstrap** — Carnegie class assigned by R&D thresholds ($50M+ = R1, $5M+ = R2). Real Carnegie uses doctoral output, but this is a reasonable proxy until the full Carnegie Excel is integrated.
- **Medical school detection via life_sciences share** — >60% of total R&D in life_sciences is a strong signal. Not perfect, but catches the worst offenders (health science centers).
- **Filter panel hidden in custom peer mode** — When users manually select peers, classification filters don't apply (they've already chosen their peers).

### Alternatives rejected
- **Separate pre-fitted models per filter combo** — Combinatorial explosion (2^8 filter combos). Brute-force is fast enough.
- **Server-side filter persistence (database)** — Over-engineering for now. Filters live in React state and URL params.
- **Hard-coding Carnegie from a static CSV** — Would go stale. The bootstrap script is re-runnable when new data arrives.

### Open questions
- HBCU and HSI flags are defaulted to FALSE — need IPEDS data or manual curation to populate
- UNITID crosswalk is NULL (placeholder) — real Carnegie integration requires downloading the Excel and mapping via HERD public use files
- Should the filter state persist in URL query params for shareable links? (deferred to frontend polish pass)

---

## [Frontend] Peer-set UX unification + historical year exploration — 2026-07-12

### What was built
- **Unified Peer Set card** — `PeerFilterPanel` moved out of `SnapshotTab.tsx` and into the same card as `CustomPeerSelector` in `page.tsx`, so custom peer selection and classification filters live in one place instead of two separate, easy-to-miss UI locations. Removed the now-duplicated `poolSize`/`PeerFilterPanel` logic that had been living inside `SnapshotTab`.
- **Peer-set caveat copy** — added short caveat text to `PortfolioTab.tsx` and `FederalTab.tsx` clarifying that field/agency comparisons reflect whichever peer set (default KNN, filtered, or custom) is currently active.
- **Landing KPIs follow the active peer set** — the landing KPI card and callout in `SnapshotTab.tsx` previously used a hardcoded stats object; now driven by `peerTrend.stats`, so the headline numbers always match the peer group shown elsewhere on the page.
- **Data vintage / publication-lag disclosure** — header in `page.tsx` now states the survey year range and that NSF publishes HERD data on roughly an 18-month lag, with a dynamic note when the user is viewing a year other than the latest.
- **Historical year selector** — new `viewYear` state and `VIEW_YEARS` dropdown in `page.tsx` (2010–2024), threaded through `InstitutionPicker`, `CustomPeerSelector`, and all tabs, so the whole dashboard can be viewed as of any past survey year, not just the latest.
- **Two-year side-by-side compare** — new `YearCompare.tsx` component: pick any two years, see national rank / total R&D / federal funding side by side with deltas. Embedded in `SnapshotTab.tsx` behind a collapsible toggle.

### Why
The peer-set controls had drifted into two disconnected places (custom picker in the page shell, classification filters inside one tab), which made it easy to change one without noticing the other. The historical year work came from a separate observation: the dashboard only ever showed the latest year, with no way to look back or compare periods, even though the underlying data goes back to 2010.

### Key decisions
- **Single source of truth for peer set** — peer selection (custom or filtered) now lives entirely in `page.tsx` state and is passed down as props; tabs no longer maintain their own copies of pool size or filter state.
- **Landing stats sourced from the same peer-trend call already used elsewhere** — avoided introducing a second "landing stats" computation path that could silently diverge from the Peer Analysis section.
- **Year selector reuses existing endpoints' `year` param** — no backend changes needed; `viewYear` just changes which year is requested from already-existing endpoints.
- **Two-year compare is a new component, not a mode of the existing rank chart** — keeps the existing trend chart's behavior untouched and makes the comparison feature easy to collapse/hide.

### Alternatives rejected
- Keeping classification filters inside `SnapshotTab` only — rejected because Portfolio and Federal tabs also depend on the active peer set; a tab-local filter UI implied (incorrectly) that the filter only affected that one tab.
- Building historical year support as a single "start/end" range picker only — rejected in favor of a dedicated two-year compare view, since the existing growth-window selector already covers the "trend over N years" case; side-by-side comparison of two arbitrary years is a distinct question.

### Open questions
- None of this session's peer-set/year-selector work has dedicated automated tests yet — verified manually against UNT and a couple of other institutions.

---

## [Feature 4] Narrative Briefing — reduced scope — 2026-07-12

### What was built
- `api/services/narrative.py` — gathers rank trend, CAGR vs. the currently active peer group (default KNN, filtered by `n`, or custom peer IDs — same resolution pattern as `/institutions/{inst_id}/insight`), closest peer by rank within that group (with the current dollar gap), largest field, and top federal agency. Passes this to Gemini with a prompt scoped to a fixed 5-part JSON structure (headline, growth vs. peers, peer landscape, portfolio signal, federal signal) plus a footnote assembled in code.
- `api/routers/briefing.py` — `GET /briefing/{inst_id}`, registered in `main.py`. Returns the JSON briefing; no PDF work happens server-side.
- Frontend: `getBriefing()` in `lib/api.ts`, `BriefingResponse`/`BriefingSection` types, and a new `BriefingButton.tsx` component that calls the endpoint and renders a one-page PDF via a lazy (`import()`-on-click) `jspdf` dependency, then triggers a browser download. Wired into `page.tsx` next to the tab bar.

### Why
CLAUDE.md's original Feature 4 spec assumes Features 1 (Scenario Modeling) and 3 (Forward Projection) already exist ("+$5M would move us to #132", "projected to overtake us by FY2027") — neither is built, and both are blocked on Phase 4 (DuckDB), which was explicitly skipped in favor of Phase 7. Rather than wait on that dependency chain, the briefing was scoped down to only what's honestly computable from data that exists today.

### Key decisions
- **Option "a" (reduced scope), not full CLAUDE.md spec** — the briefing states current rank, historical CAGR vs. peers, and the present dollar gap to the nearest-ranked peer (all backward-looking facts), but never states or implies a future crossover year or a hypothetical investment's effect. The Gemini prompt includes explicit rules forbidding both, mirroring/extending the "never use risk/warning/concern" guardrail pattern already used in `institutions.py`'s `/insight` endpoint.
- **Option 2 structure (condensed one-pager)**, not a tab-by-tab mirror of the dashboard — header, headline, growth-vs-peers, peer landscape, portfolio signal, federal signal, footnote. Keeps the output usable as an actual one-page document rather than a re-export of every chart.
- **`GET`, not `POST /briefing/generate`** — there's no simulation input to submit; the endpoint just reads whichever peer group is currently active, so it follows the same `GET` convention as `/insight` and `/suggested-questions`.
- **PDF rendering is client-side (`jsPDF`), not server-side (`fpdf2`)** — decided specifically to avoid adding a PDF-generation dependency and CPU work to the API container for something that only needs to run once, in the user's browser, on click. `jsPDF` is dynamically imported so it's excluded from the initial JS bundle.
- **JSON parsing with a fallback** — if Gemini's response isn't valid JSON (rare, but not guaranteed), the service falls back to a minimal briefing assembled directly from the computed data rather than failing the request outright.

### Alternatives rejected
- Building the full CLAUDE.md-spec'd briefing (scenario + projection sections) now — rejected; would require building Features 1/3 and Phase 4 (DuckDB) first, none of which were in scope for this pass.
- Server-side PDF generation (`fpdf2`) — rejected to keep the API lightweight and avoid a server-side rendering dependency for a document that's naturally a client-side, one-time render.
- LLM-generated JSON via a strict response schema (`response_mime_type="application/json"`) — considered, but the codebase's existing Gemini usage (`qa.py`, `institutions.py`) doesn't use structured output mode anywhere; kept the same prompt-and-parse pattern for consistency, with a plain-data fallback covering the failure case.

### Open questions
- Features 1 (Scenario Modeling), 2 (Peer Movement Tracker), and 3 (Forward Projection) remain unbuilt; the briefing will need a follow-up pass once those exist and Phase 4 (DuckDB) is built, per the revisit trigger logged in CLAUDE.md's Build Phases status table.
- No automated tests yet for `narrative.py` or `/briefing/{inst_id}` — verified manually against UNT (`inst_id=003594`).

---

## [Feature 4] Narrative Briefing — content & layout pass — 2026-07-12

### What was built
- Backend (`api/services/narrative.py`): added `state_rank` to the `mart_rankings` query; built a deterministic `peer_table` (target institution + up to 7 nearest-by-rank peers, sorted by rank); exposed the already-fetched rank series as `rank_trend` (year/national_rank/total_rd); computed a non-LLM `key_metrics` list (National Rank, State Rank, Total R&D, Growth CAGR vs. peer avg, Federal Share vs. national median, Largest Field). Softened the Gemini headline prompt (added an explicit rule) so it states rank movement neutrally instead of framing it as a "positive trajectory" when growth actually trails the peer average.
- Frontend types (`frontend/lib/types.ts`): extended `BriefingResponse` with `key_metrics`, `peer_table`, `rank_trend`.
- Frontend PDF (`frontend/components/BriefingButton.tsx`): full `renderPdf()` rewrite — accent-color header bar, shaded headline callout box, a 2-column Key Metrics grid, a Peer Comparison table (target row highlighted), a hand-drawn Total R&D trend line chart (native jsPDF `line()` calls, no charting library dependency), the existing narrative sections retained, and a footer (generated date + page number) applied to every page via a pagination helper that adds a new page when content would overflow the bottom margin.

### Why
User feedback on the first version (3 screenshots) was that the one-page PDF was mostly white space and didn't serve the documented personas in CLAUDE.md: VPRs need a real peer table (not prose naming one "closest peer"), Government Relations/state-facing personas were missing state rank entirely (it exists in `/insight` but had been dropped from the briefing), and Research Development needs scannable stats, not paragraphs. A secondary issue was flagged during review: the headline could read as spin (claiming a "positive trajectory" adjacent to below-peer-average growth data) — fixed by making the prompt's language rules stricter.

### Key decisions
- **key_metrics, peer_table, and rank_trend are computed in Python, not by Gemini** — same "deterministic over LLM-generated" principle already used for `suggested-questions`; guarantees the numbers on the page can't be hallucinated, and keeps the LLM scoped to the 5 prose sections only.
- **Peer table shows up to 7 nearest-by-rank peers**, not the full active peer set — keeps the one-page (or two-page, with pagination fallback) document scannable rather than dumping the entire KNN/custom peer list.
- **Chart is hand-drawn with jsPDF primitives**, not a charting library — avoids adding a new dependency for one static line, consistent with the existing "jsPDF is lazy-loaded, keep it lightweight" decision from the original Feature 4 pass.
- **Pagination helper (`ensureSpace`)** added since the fuller layout (metrics grid + peer table + chart + narrative) no longer reliably fits on one page for institutions with longer prose or larger peer tables; footer (date + page number) is applied in a final pass over all pages after content renders.

### Alternatives rejected
- Keeping the briefing capped to exactly one page — rejected once the added tables/chart made that infeasible for all institutions; a pagination fallback was chosen over truncating content or shrinking fonts further.
- Third-party PDF charting (e.g. jsPDF plugins) for the trend line — rejected as unnecessary weight for a single line series.

### Open questions
- Same as prior briefing entry: Features 1/2/3 (scenario modeling, peer movement, projections) and Phase 4 (DuckDB) are still unbuilt; this briefing remains backward-looking only.
- No automated tests yet for the new `key_metrics`/`peer_table`/`rank_trend` fields — verified manually via `curl` against `inst_id=003594` after `docker compose restart api`, and `tsc --noEmit` passes clean on the frontend.
