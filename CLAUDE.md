# NSF HERD v2 — Project Document

## Project Purpose

Rebuild the NSF HERD Research Intelligence Platform using a modern data engineering stack. The current version (`nsf-herd-mvp`) is a working Streamlit app with raw Python scripts and SQLite. This rebuild serves two goals:

1. **Learn production-grade tools** — Docker, Postgres, dbt, DuckDB, Dagster, FastAPI, React, GitHub Actions
2. **Add decision-engine features** — scenario modeling, peer movement tracking, forward projection, narrative export

The current app tells VPRs where they are. This version tells them where to go.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│                                                              │
│   React + Next.js                                            │
│   Charts: Recharts                                           │
│   Auth: Supabase Auth (same as v1)                           │
│                                                              │
├──────────────────────┬──────────────────────────────────────-┤
│                      │  HTTP / JSON                          │
├──────────────────────▼──────────────────────────────────────-┤
│                        FASTAPI                               │
│                                                              │
│   /institutions    — list, detail, rank                      │
│   /peers           — KNN matching, gap analysis              │
│   /scenarios       — what-if modeling                        │
│   /projections     — forward trajectory                      │
│   /portfolio       — field analysis                          │
│   /federal         — agency analysis                         │
│   /qa              — natural language queries                │
│   /briefing        — narrative export                        │
│                                                              │
├──────────────────────┬──────────────────────────────────────-┤
│                      │  SQL                                  │
├──────────────────────▼──────────────────────────────────────-┤
│   POSTGRES (OLTP)          │   DUCKDB (OLAP)                │
│   Raw + staging tables     │   Analytical queries            │
│   User preferences         │   Aggregations, CAGRs           │
│   Usage logging             │   Peer comparisons              │
│                             │   Scenario computations         │
├─────────────────────────────┴───────────────────────────────-┤
│                     DAGSTER                                   │
│                                                              │
│   Asset: raw_herd_data     (dlt ingestion)                   │
│   Asset: stg_institutions  (dbt staging)                     │
│   Asset: stg_fields        (dbt staging)                     │
│   Asset: stg_agencies      (dbt staging)                     │
│   Asset: mart_rankings     (dbt mart)                        │
│   Asset: mart_peer_metrics (dbt mart)                        │
│   Asset: mart_field_portfolio (dbt mart)                     │
│   Asset: mart_trajectories (dbt mart)                        │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                   GITHUB ACTIONS                             │
│                                                              │
│   On push: dbt test → dbt build → API health check          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Repo Structure

```
nsf-herd-v2/
├── docker-compose.yml
├── .env.example
├── CLAUDE.md                        ← this file
│
├── ingestion/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── herd_pipeline.py             ← dlt pipeline
│
├── dbt/
│   ├── dbt_project.yml
│   ├── profiles.yml
│   ├── models/
│   │   ├── staging/
│   │   │   ├── _staging.yml         ← schema + tests
│   │   │   ├── stg_institutions.sql
│   │   │   ├── stg_field_expenditures.sql
│   │   │   └── stg_agency_funding.sql
│   │   └── marts/
│   │       ├── _marts.yml           ← schema + tests
│   │       ├── mart_rankings.sql
│   │       ├── mart_peer_metrics.sql
│   │       ├── mart_field_portfolio.sql
│   │       ├── mart_peer_movement.sql
│   │       └── mart_trajectories.sql
│   ├── tests/
│   │   ├── assert_field_totals_equal_total_rd.sql
│   │   ├── assert_agency_sums_equal_federal.sql
│   │   └── assert_subfield_sums_equal_parent.sql
│   ├── macros/
│   │   └── cagr.sql                 ← reusable CAGR macro
│   └── seeds/
│       └── (optional: CSV files for initial load)
│
├── api/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                      ← FastAPI app
│   ├── config.py                    ← env var loading
│   ├── db.py                        ← Postgres + DuckDB connections
│   ├── routers/
│   │   ├── institutions.py
│   │   ├── peers.py
│   │   ├── scenarios.py
│   │   ├── projections.py
│   │   ├── portfolio.py
│   │   ├── federal.py
│   │   ├── qa.py
│   │   └── briefing.py
│   └── services/
│       ├── benchmarker.py           ← KNN logic (ported from v1)
│       ├── scenario_engine.py       ← what-if computations
│       └── narrative.py             ← briefing generation
│
├── orchestration/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── assets.py                    ← Dagster asset definitions
│
├── frontend/                        ← Phase 7 (React + Next.js, done)
│
├── .github/
│   └── workflows/
│       └── ci.yml                   ← dbt test + API health check
│
└── docs/
    └── decisions.md                 ← architecture decision log
```

---

## New Features (Not in v1)

### Feature 1: Scenario Modeling ("What If" Engine)

**User story**: A VPR slides a bar to add $5M to Engineering. The dashboard instantly shows:
- New national rank (moved from #147 to #132)
- Which peers they'd overtake (Texas State, Utah State)
- New portfolio share breakdown
- New field momentum position

**Implementation**:
- FastAPI endpoint: `POST /scenarios/simulate`
- Input: `{ inst_id, field_code, delta_amount, year }`
- Logic: Take current year data, adjust the field total, recompute rank against all institutions, recompute portfolio share, identify peers overtaken
- Query engine: DuckDB (fast re-ranking of 1,004 institutions)
- No data mutation — all computations are in-memory on top of mart tables

**What you learn**: DuckDB analytical queries, FastAPI request/response design, separation of read vs compute layers.

---

### Feature 2: Peer Movement Tracker

**User story**: A VPR sees an alert card: "Texas State jumped 23 ranks in 3 years. They grew Engineering by 18% CAGR. They're now within $8M of passing you."

**Implementation**:
- dbt mart model: `mart_peer_movement.sql`
  - For each peer: rank change over window, CAGR, dollar gap to target, fields driving growth
  - Flag peers whose rank delta is closing (convergence signal)
- FastAPI endpoint: `GET /peers/{inst_id}/movement?years=5`
- Returns: list of peers sorted by "threat level" (closing gap + high CAGR)

---

### Feature 3: Forward Projection ("At This Rate")

**User story**: A VPR sees a chart with a dashed line extending 3 years into the future. "At current growth rates, Texas State will overtake you in total R&D by FY2027."

**Implementation**:
- dbt mart model: `mart_trajectories.sql`
  - Compute CAGR for each institution over selected window
  - Project total_rd forward 1, 2, 3 years using CAGR
  - Identify crossover points (year when a peer's projected total_rd exceeds yours)
- FastAPI endpoint: `GET /projections/{inst_id}?years_forward=3`
- Returns: projected values + crossover alerts

**What you learn**: Time series projection in SQL, dbt model layering (staging → mart → projection).

**Important**: Always label projections as "At current growth rates" — these are trajectories, not predictions. VPRs understand the difference.

---

### Feature 4: Narrative Export (Provost-Ready Briefing)

**User story**: A VPR clicks "Generate Briefing" and gets a 1-page document they can forward to their provost:

> **Research Positioning Brief — University of North Texas**
> FY2024 | Prepared for Office of the VPR
>
> UNT ranks #147 nationally in total R&D ($178M), up 12 positions over 5 years.
> Growth of 8.2% CAGR outpaces our 10 benchmark peers (avg 5.1%).
> However, Texas State has closed the gap from $42M behind to $8M and is
> projected to overtake us by FY2027 at current rates.
>
> Recommended focus: Engineering (+$5M investment would move us to #132
> and overtake 3 peers).

**Implementation**:
- FastAPI endpoint: `POST /briefing/generate`
- Pulls data from mart models (rank, peers, projections, scenarios)
- LLM generates executive narrative from structured data points
- Returns: JSON with sections (can render as HTML, PDF, or React component)
- Library for PDF: `fpdf2` (lightweight, no browser dependencies)

**What you learn**: LLM prompt engineering for structured output, document generation, API design for complex responses.

**Status (as of 2026-07-12): built in reduced scope.** The user story above assumes Features 1 (Scenario Modeling) and 3 (Forward Projection) already exist — they don't, and both are still blocked on Phase 4 (DuckDB). Rather than wait, the briefing was built against only what's computable today:
- No "projected to overtake us by FY2027 at current rates" — no forward-projection claims.
- No "+$5M investment would move us to #132" — no scenario/investment claims.
- Sections actually shipped: headline, growth vs. peers, peer landscape (closest peer by rank + current dollar gap — historical fact, not a projection), portfolio signal, federal signal, footnote.
- `GET /briefing/{inst_id}` (not `POST /briefing/generate` — there's no simulation input, it just reads whichever peer group is currently active, same as `/institutions/{inst_id}/insight`).
- PDF generation is client-side (`jsPDF`, lazy-loaded in the frontend on click) instead of server-side `fpdf2` — keeps the API JSON-only and avoids adding a PDF dependency to every API container.
See `docs/decisions.md` ("[Feature 4] Narrative Briefing") for full reasoning.

---

## Deferred Features (Do Not Build Yet)

### Multi-Source Enrichment (IPEDS + Federal Radar)
- **IPEDS**: Faculty counts, enrollment, Carnegie classification → R&D per faculty metric
- **Federal Radar**: The separate project pulling grants from NSF, NIH, USAspending.gov
- **Plan**: Build a centralized data platform later that connects Federal Radar + HERD v2 + IPEDS
- **When**: After the core v2 is deployed and the tech stack is solid
- **Note**: This is where dlt + Dagster truly shine — pulling from 3+ APIs into one warehouse. Save it for when you can appreciate why orchestration matters.

### R&D Per Faculty (Depends on IPEDS)
- Blocked by IPEDS integration
- Once IPEDS faculty data is in Postgres, this is a single dbt model join
- Deferred with IPEDS above

---

## User Personas

The tool serves a wider audience than just VPRs. Below is the full map of personas in the university research ecosystem who would use R&D positioning intelligence, organized by tier (frequency of use + decision-making leverage). This informs UI design — different personas need different views, outputs, and interaction patterns.

### Tier 1: Primary Users (weekly/monthly, high decision leverage)

**Vice President for Research (VPR) / Chief Research Officer**
- Also titled: VP for Research & Innovation, VP for Research & Economic Development, Associate Provost for Research
- Cares about: National rank, peer benchmarking, portfolio balance, growth trajectory, federal funding mix
- Uses tool for: Budget justification to provost, strategic planning, board presentations, identifying investment gaps
- Key question: "Where should our next dollar go to move us the most?"
- Frequency: Weekly during planning season, monthly otherwise

**Associate/Assistant VP for Research**
- Cares about: Same as VPR but more operational — translating strategy into programs
- Uses tool for: Building the case for new initiatives (seed grants, cluster hires), monitoring whether investments are paying off year-over-year
- Key question: "Is our 3-year investment in Engineering showing up in the numbers yet?"
- Frequency: Weekly

**Associate Dean for Research (college-level)**
- One per college (Engineering, Sciences, Liberal Arts, Medicine, etc.)
- Cares about: Their specific field's national position, not the whole institution
- Uses tool for: Justifying resource requests to their dean, understanding which sub-fields are growing nationally, comparing their college to peer college equivalents
- Key question: "Where does our Engineering school rank among our peer set's Engineering schools?"
- Frequency: Monthly, heavily during annual budget cycle

**Dean (of a research-intensive college)**
- Cares about: College-level totals, faculty productivity context, making the case for new lines/space
- Uses tool for: Strategic hire justification ("peer institutions have 15 more Engineering faculty and outspend us by $40M"), provost conversations about investment priorities
- Key question: "What's the gap between us and our aspirational peers in my college's fields?"
- Frequency: Quarterly, heavily at budget time

### Tier 2: Strategic Decision-Makers (monthly/quarterly, high influence)

**Provost / Executive VP for Academic Affairs**
- Cares about: Institution-wide positioning, ROI on research investments, balancing research vs teaching missions
- Uses tool for: Consuming briefings (not building them), comparing VPR's requests against data, board of trustees presentations
- Key question: "Is our research enterprise growing faster or slower than peers, and is VPR's budget request justified?"
- Frequency: Quarterly (reads briefings, doesn't explore dashboards)
- UI implication: Needs the narrative export / PDF briefing, not interactive exploration

**President / Chancellor (single institution)**
- Cares about: Headline rank, trajectory, peer comparisons for speeches/fundraising
- Uses tool for: Talking points for donors, legislators, and boards. "We've grown research 40% in 5 years, outpacing all but 3 peers."
- Key question: "What's the one-sentence version of where we stand?"
- Frequency: Quarterly (consumes summaries only)
- UI implication: Executive summary card / one-page brief, not a dashboard

**System Chancellor (multi-institution: UC, SUNY, Texas, UNC)**
- Cares about: Portfolio across 5–15 institutions, avoiding duplication, system-wide rank, state competitiveness
- Uses tool for: Coordinating investment across institutions ("UT Arlington should grow Engineering since UT Austin owns that space — what about Materials?"), state legislature presentations
- Key question: "How does our system perform against other state systems, and where are the internal gaps/overlaps?"
- Frequency: Quarterly
- UI implication: Multi-institution comparison view (doesn't exist yet)

**Board of Trustees / Regents**
- Cares about: Is the institution gaining or losing ground? Are we spending wisely?
- Uses tool for: They don't use it directly — they receive briefings. But the data shapes what they see.
- UI implication: PDF/slide export that a VPR or president hands them

### Tier 3: Research Administration & Development (weekly, operational)

**Director of Research Development**
- Cares about: Institutional strengths/weaknesses for limited submission decisions, proposal boilerplate, identifying emerging federal priorities
- Uses tool for: Writing "institutional capacity" sections of proposals, deciding which internal candidates to put forward for limited submissions, tracking whether the institution is competitive in a field before investing effort
- Key question: "Are we credible enough in field X to win a center-level award, or are we a long shot?"
- Frequency: Weekly (proposal deadlines are constant)
- UI implication: Quick field-level lookup, exportable stats for copy-paste into proposals

**Research Development Officers / Pre-Award Staff**
- Cares about: Specific data points for specific proposals (rank in field, growth rate, federal agency funding)
- Uses tool for: Pulling stats into grant narratives. "PI needs a paragraph about our institution's NSF funding trajectory."
- Key question: "What's our exact rank in [field] and how much NSF funding did we receive last year vs 5 years ago?"
- Frequency: Multiple times per week
- UI implication: Search → stat → copy. Minimal clicks to a quotable number.

**Director of Sponsored Programs / Office of Sponsored Research**
- Cares about: Proposal volume, success rates (not in HERD data), federal funding concentration risk
- Uses tool for: Understanding institutional dependency on specific agencies, flagging if one agency represents too much of the portfolio
- Key question: "If NIH flat-funds for 3 years, how exposed are we vs peers?"
- Frequency: Monthly

**Government Relations / Federal Affairs Officer**
- Cares about: Talking points for congressional visits, positioning the institution for federal earmarks/programs
- Uses tool for: "Senator, our institution ranks #X in federal R&D in your state, and we've grown Y% — here's what continued investment enables"
- Key question: "How do we rank within our state and congressional district for federal R&D?"
- Frequency: Quarterly (aligned with Hill visits, appropriations cycles)
- UI implication: State-level and agency-level views, exportable one-pagers

### Tier 4: Adjacent Institutional Roles (monthly, supporting)

**Director of Institutional Research (IR)**
- Cares about: Data accuracy, survey compliance, benchmarking for accreditation
- Uses tool for: Cross-referencing HERD data with IPEDS, Carnegie, and internal data; validating their own reporting
- Key question: "Does our internally reported R&D match what NSF published? How do we compare on research intensity metrics?"
- Frequency: Monthly, heavily at survey/accreditation time

**Technology Transfer Officer (TTO/OTT Director)**
- Cares about: Research volume as input to commercialization pipeline, field-level investment as predictor of IP output
- Uses tool for: Context on where institutional research investment is going (upstream of their licensing/patents work)
- Key question: "Which fields are growing fastest in expenditure? That's where our disclosure pipeline should thicken."
- Frequency: Quarterly

**VP for Advancement / Development (Fundraising)**
- Cares about: Narrative for major gift asks, research growth story for campaigns
- Uses tool for: "We've invested $X in Y and moved Z ranks — your naming gift accelerates that trajectory"
- Key question: "What's the most compelling growth story I can tell a donor about our research enterprise?"
- Frequency: Quarterly
- UI implication: Narrative/story mode, not analytical mode

**Graduate School Dean**
- Cares about: Research expenditure as proxy for PhD student support capacity, field-level growth indicating where new programs should launch
- Uses tool for: Justifying new PhD programs ("national investment in this field is growing 12% CAGR — we should be training students here")
- Key question: "Which fields are growing fastest nationally? Do we have PhD programs in those fields?"
- Frequency: Annually (program planning cycles)

**Communications / PR Director**
- Cares about: Press release hooks ("University reaches record R&D spending," "Fastest-growing research enterprise in the state")
- Uses tool for: Finding the superlative — whatever "first," "fastest," or "largest" claim is defensible
- Key question: "What's newsworthy about our latest HERD numbers?"
- Frequency: Annually (when NSF releases new data)

### Tier 5: External / Multi-Institutional (less frequent, different access model)

**State Higher Ed Board / Coordinating Board Staff**
- Cares about: State-wide research capacity, inter-institution coordination, legislative reporting
- Uses tool for: "Here's how our state's research enterprise compares to competing states (Texas vs California, Ohio vs Michigan)"
- Key question: "Is our state gaining or losing share of national R&D? Which institutions are driving that?"
- UI implication: State-level aggregate view, multi-institution roll-up

**State Legislative Staff (Appropriations / Higher Ed Committees)**
- Cares about: ROI on state appropriations to universities, inter-state competition
- Uses tool for: Briefing legislators before budget votes — "our flagship has grown R&D $X since the state invested $Y"
- Key question: "Are our public universities competitive with peer states?"
- Frequency: Annually (budget cycle)

**Professional Associations (AAU, APLU, COGR)**
- Cares about: Sector-wide trends, advocacy data for federal funding
- Uses tool for: Reports like "Federal research funding hasn't kept pace with..." using aggregate HERD data
- Key question: "What's the national trend in [metric] and how do our member institutions compare?"
- Frequency: Annually

**Consulting Firms / Higher Ed Strategy (e.g., EAB, Huron, rpk GROUP)**
- Cares about: Benchmarking clients, identifying growth opportunities
- Uses tool for: Same analysis VPRs do, but for multiple client institutions
- Key question: "Where are the gaps in Client X's portfolio relative to aspirational peers?"
- UI implication: Multi-institution workspace, client-by-client saved views

### UI Implications by Persona Cluster

| Cluster | What they need from the UI | Current coverage |
|---|---|---|
| VPR / AVP / Assoc Dean | Full interactive dashboard, scenario modeling, peer selection | Most of this exists |
| Dean / Provost / President | Briefing documents, executive summaries, 1-page exports | Planned (Feature 4) but not built |
| Research Development | Quick stat lookup, copy-paste numbers, field-level search | Partially covered (portfolio tab) |
| Government Relations / Advancement | Narrative + data points for external audiences, state-level views | Minimal (state rank exists, no export) |
| System Chancellor / State Board | Multi-institution comparison, state-level aggregate | Does not exist |
| Board / Trustees | PDF briefing they receive, not a login | Planned (Feature 4) |
| Consulting / External | Multi-client workspace, saved comparisons | Does not exist |

### Key Gaps (current UI vs full persona map)

1. **Single-institution assumption** — the tool currently assumes one user looking at one institution at a time. System-level, state-level, and multi-institution views are an entirely different mode that doesn't exist yet.
2. **Output/export layer** — most personas above Tier 3 don't want to explore a dashboard; they want to receive a document (PDF briefing, slide deck, one-pager with stats).
3. **Quick-stat mode** — Research Development officers need search → number → copy in under 10 seconds. The current dashboard is built for exploration, not extraction.

---

## Build Phases

### Current Status (as of 2026-07-12)

Phases were **not** built strictly in the order below. Actual build order:

| Phase | Status | Notes |
|---|---|---|
| 1. Docker + Postgres | ✅ Done | |
| 2. dbt Core | ✅ Done | 8 models, 40 tests passing |
| 3. FastAPI | ⏸ Partial | institutions/peers/portfolio/federal/qa/classifications built. Feature 4 (briefing) built in **reduced scope**: `GET /briefing/{inst_id}` returns a narrative-only JSON briefing (rank, CAGR vs. active peer group, portfolio signal, federal signal) with no scenario or projection claims — see `docs/decisions.md` ("[Feature 4] Narrative Briefing"). `scenarios` (Feature 1) and `projections` (Feature 3) remain explicitly deferred; both still depend on Phase 4 (DuckDB) per the original design. Feature 2 (peer movement tracker) also not yet built. |
| 4. DuckDB | ⬜ Not started | Skipped in favor of Phase 7 — revisit before Features 1/3 (scenario/projection) can be built |
| 5. Dagster | ⬜ Not started | Skipped in favor of Phase 7 |
| 6. GitHub Actions CI | ⬜ Not started | Skipped in favor of Phase 7 |
| 7. Frontend | ✅ Done | Built immediately after Phase 3, ahead of Phases 4–6. Next.js/React chosen over Reflex (see decision below). Full v1 parity + per-institution suggested questions, unified peer-set selection UX, historical year selector with two-year side-by-side compare, and client-side PDF briefing export (jsPDF, lazy-loaded — no server-side PDF dependency) |

**Why the order changed**: after Phase 3 shipped a usable read API, the call was made to get a demoable end-to-end product (API + UI) working before investing in DuckDB/Dagster/CI, which have no user-visible payoff on their own. Phases 4–6 are not abandoned — see the revisit trigger logged in `docs/decisions.md` ("[Phase 7] Frontend stack reaffirmed").

**Revisit trigger**: Feature 4 (briefing) was picked back up on 2026-07-12 and built in reduced scope — narrative-only, no scenario/projection claims — precisely because Features 1 (Scenario Modeling) and 3 (Forward Projection) aren't built yet and DuckDB (Phase 4) is a prerequisite for both. Feature 2 (Peer Movement Tracker) still remains unbuilt. Next work should return to either (a) Phases 4–6 in order, or (b) Features 1/2/3 directly. Decide explicitly before starting; don't let this drift again.

---

### Phase 1: Docker + Postgres (Foundation) — ✅ Done

**Goal**: One command (`docker compose up`) gives you a running Postgres with the HERD schema.

**Verify it works**:
```bash
docker compose up -d
docker compose exec postgres psql -U herd -d herd_db -c "SELECT COUNT(*) FROM institutions;"
# Should return 10084
```

**Key decisions**:
- Postgres user: `herd`, database: `herd_db`
- Port: 5432 (standard)
- Volume: `pgdata` (persists data between restarts)
- No Neon for local dev — use containerized Postgres (zero cold starts, no 0.5GB limit)

---

### Phase 2: dbt Core (Transformation + Tests) — ✅ Done

**Goal**: Replace the 6 Python ETL scripts with SQL models that are tested and documented.

**Verify it works**:
```bash
cd dbt
dbt run        # builds all models
dbt test       # runs all tests (should be 0 failures)
dbt docs generate && dbt docs serve  # visual DAG + docs
```

**Critical tests (must pass)**:
1. `SUM(field_expenditures.total WHERE is_parent=1) = institutions.total_rd` per inst_id/year
2. `SUM(agency_funding.amount) = institutions.federal` per inst_id/year
3. For each parent field with sub-fields: `parent.total = SUM(sub_field.total)`
4. `total_rd = federal + state_local + business + nonprofit + institutional + other_sources`
5. No null `inst_id` or `year` in any table
6. Year range: 2010–2024 only

**dbt modeling rules**:
- Staging models are 1:1 with source tables. Clean column names, cast types, handle nulls.
- Mart models are business logic. Join tables, compute metrics, pre-aggregate.
- Never modify source data in staging — only rename, cast, filter.
- Every mart model must have at least one test.
- Use `{{ ref('stg_institutions') }}` never raw table names in mart models.

---

### Phase 3: FastAPI (API Layer) — ⏸ Partial

**Goal**: Every query the Streamlit app makes is now an HTTP endpoint.

**Status**: `institutions`, `peers`, `portfolio`, `federal`, `qa`, `classifications` routers are built and verified. `briefing` (Feature 4) is built in **reduced scope** — narrative-only JSON, no scenario or projection claims, `GET` instead of `POST` (no input to simulate, just reads whatever peer group is active) — see `docs/decisions.md` ("[Feature 4] Narrative Briefing"). `scenarios` (Feature 1) and `projections` (Feature 3) remain explicitly deferred — not forgotten. Both also depend on Phase 4 (DuckDB) per the original design.

**Remaining to build**: `api/routers/scenarios.py` (Feature 1), `api/routers/projections.py` (Feature 3), `api/services/scenario_engine.py` — all blocked on Phase 4 (DuckDB).

**Verify it works**:
```bash
# In docker-compose, api service runs on port 8000
curl http://localhost:8000/institutions?limit=5
curl http://localhost:8000/peers/003594          # UNT's peers
curl http://localhost:8000/docs                  # Swagger UI
```

**Porting guide from v1**:
| v1 method | v2 endpoint |
|---|---|
| `engine.get_institution_list()` | `GET /institutions` |
| `engine.get_rank_trend(name, start, end)` | `GET /institutions/{inst_id}/rank?start=2019&end=2024` |
| `engine.get_anchor_view(name, year)` | `GET /institutions/{inst_id}/anchor?year=2024` |
| `engine.get_funding_breakdown(name, start, end)` | `GET /institutions/{inst_id}/funding?start=2019&end=2024` |
| `engine.get_state_ranking(name, year, start)` | `GET /institutions/{inst_id}/state-rank?year=2024` |
| `engine.get_field_portfolio(name, year)` | `GET /portfolio/{inst_id}?year=2024` |
| `engine.get_field_momentum(name, start, end)` | `GET /portfolio/{inst_id}/momentum?start=2019&end=2024` |
| `engine.get_agency_breakdown(name, year)` | `GET /federal/{inst_id}?year=2024` |
| `engine.get_agency_concentration(name, year)` | `GET /federal/{inst_id}/concentration?year=2024` |
| `benchmarker.get_peer_inst_ids(inst_id)` | `GET /peers/{inst_id}` |
| `benchmarker.analyze_gap(inst_id)` | `GET /peers/{inst_id}/gap` |
| `benchmarker.get_peer_trend(inst_id, ...)` | `GET /peers/{inst_id}/trend?start=2019&end=2024` |
| `engine.ask(question, context)` | `POST /qa/ask` |
| (new) | `POST /scenarios/simulate` |
| (new) | `GET /projections/{inst_id}` |
| (new) | `GET /briefing/{inst_id}` — built as `GET`, not `POST /briefing/generate` as originally sketched; narrative-only, no scenario/projection claims (see Deferred Features) |

**API design rules**:
- All endpoints return JSON. No HTML, no Streamlit widgets.
- Use Pydantic models for request/response validation.
- inst_id is the primary key — never accept institution name as a path parameter.
- All dollar amounts returned as integers (cents or dollars, consistent).
- Errors return proper HTTP status codes (404 for unknown inst_id, 422 for bad params).
- Rate limiting on /qa/ask (50/hour per user, same as v1).

---

### Phase 4: DuckDB (Analytical Layer) — ⬜ Not started

**Goal**: Heavy analytical queries (peer comparisons, CAGR computations, scenario simulations) run on DuckDB for speed.

**Implementation**:
- DuckDB connects to Postgres via `postgres_scanner` extension (reads Postgres tables directly)
- Or: DuckDB reads from Parquet files exported by dbt
- Scenario modeling queries run entirely in DuckDB (re-ranking 1,004 institutions in memory)

**Files to create/modify**:
- `api/db.py` — add DuckDB connection alongside Postgres
- `api/routers/scenarios.py` — uses DuckDB for fast re-ranking
- `api/routers/projections.py` — uses DuckDB for CAGR extrapolation

**What you learn**:
- DuckDB embedded analytics (no server, in-process)
- When to use OLTP (Postgres: row lookups, user data) vs OLAP (DuckDB: aggregations, analytics)
- Cross-database queries (DuckDB reading from Postgres)

**Verify it works**:
```python
import duckdb
conn = duckdb.connect()
conn.execute("INSTALL postgres; LOAD postgres;")
conn.execute("ATTACH 'dbname=herd_db user=herd host=localhost' AS pg (TYPE POSTGRES)")
result = conn.execute("SELECT COUNT(*) FROM pg.institutions").fetchone()
# Should return (10084,)
```

---

### Phase 5: Dagster (Orchestration) — ⬜ Not started

**Goal**: One command runs the entire pipeline — ingestion, dbt build, dbt test — with lineage and observability.

**Files to create**:
- `orchestration/Dockerfile`
- `orchestration/requirements.txt`
- `orchestration/assets.py` — Dagster asset definitions
- Update `docker-compose.yml` — add Dagster webserver + daemon services

**Asset definitions**:
```python
# Each dbt model becomes a Dagster asset automatically
from dagster_dbt import DbtCliResource, dbt_assets

@dbt_assets(manifest=dbt_manifest_path)
def herd_dbt_assets(context, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()
```

**What you learn**:
- Asset-based orchestration (vs task-based like Airflow)
- Dagster + dbt integration (dbt models as Dagster assets)
- Lineage visualization (Dagster UI shows the full DAG)
- Sensors and schedules (trigger pipeline on new data file)
- Partitions (optional: partition by year for incremental loads)

**Verify it works**:
- Open Dagster UI at `http://localhost:3000`
- See all dbt models as assets with lineage
- Trigger a materialization — all assets build in order
- Green checkmarks on all dbt tests

---

### Phase 6: GitHub Actions (CI/CD) — ⬜ Not started

**Goal**: Every push runs dbt tests. A green badge proves the data pipeline is healthy.

**Files to create**:
- `.github/workflows/ci.yml`

**Pipeline steps**:
1. Spin up Postgres service (GitHub Actions service container)
2. Load seed data
3. `dbt deps` → `dbt run` → `dbt test`
4. Run FastAPI health check
5. Badge: passing/failing

**What you learn**:
- GitHub Actions workflow syntax
- Service containers (Postgres in CI)
- CI for data pipelines (not just application code)
- Build badges (credibility signal in portfolio repos)

**Verify it works**:
- Push to GitHub → Actions tab shows green workflow
- Add badge to README: `![CI](https://github.com/youruser/nsf-herd-v2/actions/workflows/ci.yml/badge.svg)`

---

### Phase 7: Frontend (React or Reflex) — ✅ Done

**Goal**: Replace Streamlit with a modern frontend that calls the FastAPI backend.

**Stack**: React + Next.js (TypeScript), Recharts, Supabase Auth SDK. Full v1 parity reached (Snapshot, Portfolio, Federal, Ask tabs) plus per-institution suggested questions, unified peer-set selection UX, historical year selector with two-year side-by-side compare, and client-side PDF briefing export (jsPDF, lazy-loaded). See `docs/decisions.md` ("[Phase 7] Frontend stack reaffirmed") for decision reasoning.

---

## Engineering Principles (Carry From v1)

These rules apply to every phase:

- **Join on inst_id, never name** — 259 institutions changed names across 15 years
- **Never mutate source data** — staging models clean, mart models transform
- **Field totals must equal total_rd** — test this in dbt, test this in CI
- **Agency sums must equal federal** — same
- **Positioning not judgment** — never use HIGH/MODERATE/LOW risk labels
- **Cache reads, never writes** — benchmarker is fitted once at API startup
- **Supabase calls are fire-and-forget** — logging never crashes the app
- **inst_id is the primary key** — API endpoints take inst_id, not name
- **No blocking operations in API handlers** — use async where possible

---

## Data Invariants (Must Pass in Every Environment)

These are non-negotiable. If any fails, the pipeline is broken.

```sql
-- 1. Field totals equal total_rd
SELECT inst_id, year
FROM stg_institutions i
WHERE total_rd != (
    SELECT COALESCE(SUM(total), 0)
    FROM stg_field_expenditures f
    WHERE f.inst_id = i.inst_id AND f.year = i.year AND f.is_parent = 1
);
-- Must return 0 rows

-- 2. Agency sums equal federal
SELECT inst_id, year
FROM stg_institutions i
WHERE federal != (
    SELECT COALESCE(SUM(amount), 0)
    FROM stg_agency_funding a
    WHERE a.inst_id = i.inst_id AND a.year = i.year
);
-- Must return 0 rows

-- 3. Sub-field sums equal parent
SELECT f.inst_id, f.year, f.field_code
FROM stg_field_expenditures f
WHERE f.is_parent = 1
AND f.total != (
    SELECT COALESCE(SUM(s.total), 0)
    FROM stg_field_expenditures s
    WHERE s.parent_field = f.field_code
    AND s.inst_id = f.inst_id AND s.year = f.year AND s.is_parent = 0
)
AND f.field_code IN ('engineering', 'life_sciences', 'physical_sciences',
                     'social_sciences', 'non_se', 'geosciences');
-- Must return 0 rows (excludes standalone parents: cs, math, psychology, other_sciences)

-- 4. Funding sources sum to total
SELECT inst_id, year
FROM stg_institutions
WHERE total_rd != federal + state_local + business + nonprofit + institutional + other_sources;
-- Must return 0 rows
```

---

## Database Schema (Postgres — matches v1 SQLite)

```sql
CREATE TABLE raw_institutions (
    inst_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    city          TEXT,
    state         TEXT NOT NULL,
    year          INTEGER NOT NULL,
    total_rd      BIGINT,
    federal       BIGINT,
    state_local   BIGINT,
    business      BIGINT,
    nonprofit     BIGINT,
    institutional BIGINT,
    other_sources BIGINT,
    PRIMARY KEY (inst_id, year)
);

CREATE TABLE raw_field_expenditures (
    inst_id      TEXT NOT NULL,
    year         INTEGER NOT NULL,
    field_code   TEXT NOT NULL,
    parent_field TEXT,
    is_parent    INTEGER NOT NULL,
    field_name   TEXT,
    federal      BIGINT,
    nonfederal   BIGINT,
    total        BIGINT,
    PRIMARY KEY (inst_id, year, field_code)
);

CREATE TABLE raw_agency_funding (
    inst_id     TEXT NOT NULL,
    year        INTEGER NOT NULL,
    agency_code TEXT NOT NULL,
    agency_name TEXT,
    amount      BIGINT,
    PRIMARY KEY (inst_id, year, agency_code)
);
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | Yes | `herd` | Postgres username |
| `POSTGRES_PASSWORD` | Yes | — | Postgres password |
| `POSTGRES_DB` | Yes | `herd_db` | Postgres database name |
| `POSTGRES_HOST` | Yes | `localhost` | Postgres host (use service name in Docker) |
| `POSTGRES_PORT` | No | `5432` | Postgres port |
| `DATABASE_URL` | Auto | — | Constructed from above: `postgresql://user:pass@host:port/db` |
| `GEMINI_API_KEY` | Yes | — | For Q&A + narrative generation |
| `SUPABASE_URL` | Yes | — | Auth + usage logging (same as v1) |
| `SUPABASE_ANON_KEY` | Yes | — | Supabase anon key (same as v1) |

---

## Deferred: Federal Radar Integration

The separate Federal Radar project pulls active grant data from NSF, NIH, and USAspending.gov.

**Future plan**: Build a centralized data platform that connects:
1. NSF HERD v2 (this project — historical R&D expenditures)
2. Federal Radar (active grants and awards)
3. IPEDS (faculty counts, enrollment, Carnegie classification)

**Architecture when integrated**:
- Shared Postgres warehouse with separate schemas: `herd`, `federal_radar`, `ipeds`
- dbt models that join across schemas (R&D per faculty, grant pipeline vs historical spend)
- Dagster orchestrates all three pipelines with cross-asset dependencies
- One FastAPI serves unified endpoints

**Do not build this now.** Get the core v2 working first. The tech stack (dlt, Dagster, dbt) is intentionally chosen to make this integration straightforward when the time comes.

---

## Mandatory: Project Context Log

After every build step, append an entry to `docs/decisions.md`. Keep it high-level — what was built, why, key decisions, and anything left open. This is the source for future technical documentation, articles, and architecture diagrams.

### Entry format

```
## [Phase N] [Short title] — [Date]

### What was built
### Why
### Key decisions
### Alternatives rejected
### Open questions
```

---

## Process Rules

- **New repo**: `nsf-herd-v2`. Never modify `nsf-herd-mvp`.
- **One phase at a time**: Do not start a new phase until the current one is verified (or explicitly, intentionally deferred). Phases don't have to run in the listed order, but any reordering or skip must be a deliberate call, logged in `docs/decisions.md`, and reflected in the status table under "Build Phases" — not a silent drift.
- **Verify before moving on**: Each phase has a "Verify it works" section. Run it.
- **Commit after each working step**: Small commits, clear messages.
- **Document decisions**: When you make an architectural choice, add it to `docs/decisions.md` — via the mandatory subagent above.
- **No Claude co-author**: Do not include `Co-Authored-By: Claude` in commit messages.
- **Ask one clarifying question max**: Then proceed.
- **Understand before moving on**: After Claude generates code, read every line. If you can't explain it, ask Claude to explain before proceeding.

