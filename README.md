# NSF HERD Research Intelligence Platform

A research positioning tool for university leaders — Vice Presidents for Research, associate deans, research development officers, and provosts. Built on NSF HERD survey data (FY2010–FY2024, 1,000+ institutions), it answers the questions that matter during strategic planning, budget justification, and peer benchmarking: where you stand nationally, how fast you're growing relative to peers, and where your portfolio is concentrated.

## What it does

### Institution Snapshot

The landing view after selecting an institution. Shows everything needed for a one-stop position assessment:

- **National rank + CAGR KPIs** — current rank, total R&D in dollars, and your N-year compound annual growth rate compared to your peer group's average
- **Automatic callout** — surfaces the single most significant signal (e.g., you rank #3 of 10 peers in growth rate, or you've climbed 15 positions nationally over 5 years)
- **Ranking Over Time** — horizontal bar chart of national rank for every year in the selected window; most recent year highlighted
- **Two-year side-by-side compare** — pick any two years from FY2010–FY2024 to compare rank, total R&D, and funding breakdown
- **Where You Sit Nationally** — anchor view showing the 10 institutions just above and below you by total R&D, so you can see your exact competitive neighborhood
- **Peer Analysis** with three sub-tabs:
  - *Funding Profile* — bar chart of your values vs peer average across all six funding sources (federal, institutional, state/local, business, nonprofit, other); expandable detailed gap table
  - *Growth Over Time* — either a summary view (your trajectory vs peer min/max band and average) or a detail view (individual line per peer); both span the full selected time window
  - *Peer Movement* — rank change, CAGR, total R&D, and dollar gap for each peer over the selected window; peers closing the gap on you are flagged "converging" and highlighted
- **Funding Source Analysis** — pie chart of current-year funding mix plus a time-series of your federal share vs the national median
- **State Competitive Position** — your rank within your state, your share of total state R&D, and a table of the top 10 institutions in your state
- **Strategic Insight** — LLM-generated one-sentence positioning summary, plus your largest research field and top federal agency (requires Gemini API key)

### Research Portfolio

Field-level breakdown of where your R&D spending is concentrated:

- Portfolio share by major field (engineering, life sciences, physical sciences, etc.) with national momentum comparison
- Sub-field drilldown within each parent field
- Portfolio distinctiveness — how your field mix compares to your peer set
- Field momentum: which fields are growing fastest nationally vs your own growth in those fields

### Federal Landscape

Agency-level view of your federal funding:

- Dollar breakdown by federal agency (NSF, NIH, DOD, DOE, NASA, USDA, etc.)
- Trend over time per agency
- Federal concentration risk — how dependent you are on any single agency vs peer average
- Agency distinctiveness within your peer set

### Ask a Question

Natural-language Q&A backed by a Gemini-powered query engine, pre-seeded with per-institution suggested questions. Examples:

- "How does our engineering R&D compare to our peers over the last 5 years?"
- "Which federal agencies have we grown the most with since 2018?"
- "What's our share of life sciences R&D vs our benchmark peers?"

The suggested questions are generated per institution based on its profile, so they surface data that's actually interesting for that institution rather than generic prompts.

### Narrative Briefing (PDF Export)

One click generates a structured research positioning brief — suitable to forward to a provost or present to a board:

- Headline rank and growth summary
- CAGR vs active peer group
- Portfolio signal (top field, concentration)
- Federal signal (top agency, concentration vs peers)
- Closest peer by rank and current dollar gap
- Footnote with data source and caveats

The briefing is generated as structured JSON by the API and rendered to a downloadable PDF in the browser via jsPDF (no server-side PDF dependency).

---

## Peer Set Selection

Every analysis in the tool uses whichever peer group is active. Three modes:

**KNN Benchmark (default)** — 10 institutions matched automatically across total R&D size, funding mix, and field profile using K-nearest neighbors. Explains itself via an expandable tooltip on the page.

**Custom Peer Selection** — Search and pick any institutions manually. All charts, gaps, and the briefing immediately re-run against your custom set.

**Classification Filters** — Narrow the KNN candidate pool before matching, using any combination of:
- Carnegie classification (R1, R2, D/PU, etc.)
- Public vs private control
- AAU membership
- APLU membership
- HBCU designation
- HSI designation
- EPSCoR eligibility

The UI shows the candidate pool size (e.g., "28 of 1,004 institutions match your filters") as filters are applied, so you know whether you're constraining too tightly before committing.

---

## Year and Time Window Controls

- **Snapshot year** — any single year from FY2010 to FY2024 (latest); the entire dashboard reflects that year's data
- **Growth window** — 5-year or 10-year lookback from the snapshot year; controls CAGR, trend charts, and peer movement analysis
- All data is NSF-reported; the app notes when you're not viewing the latest year and explains the ~18-month publication lag

---

## Data

NSF Higher Education Research and Development (HERD) Survey, FY2010–FY2024.

- ~1,004 institutions in the most recent year; ~10,000+ institution-year rows total
- Three table types: institution-level totals, field expenditures (by research field and sub-field), federal agency funding
- Data invariants enforced by dbt tests: field totals = total R&D; agency sums = federal; funding sources sum to total

---

## Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL (OLTP — institution data, mart tables) |
| Transformation | dbt (8 models, 40+ tests — staging + mart layer) |
| API | FastAPI (Python) — institutions, peers, portfolio, federal, Q&A, briefing |
| Peer matching | KNN (scikit-learn), fitted at API startup |
| LLM | Google Gemini (strategic insight + Q&A + briefing narrative) |
| Frontend | Next.js / React, Recharts, Tailwind CSS |
| PDF export | jsPDF (client-side, lazy-loaded) |
| Auth | Supabase Auth (optional; dashboard works without it) |
| Orchestration | Docker Compose |

---

## Build Status

| Phase | Status |
|---|---|
| 1. Docker + Postgres | Done |
| 2. dbt Core (staging + marts + tests) | Done |
| 3. FastAPI (institutions, peers, portfolio, federal, Q&A, classifications, briefing) | Partial — briefing in reduced scope (narrative only, no scenario/projection claims) |
| 4. DuckDB analytical layer | Not started — prerequisite for scenario modeling and forward projection |
| 5. Dagster orchestration | Not started |
| 6. GitHub Actions CI | Not started |
| 7. Frontend (Next.js) | Done |

**Deferred features** (depend on Phase 4 DuckDB):
- Scenario modeling ("what if I add $5M to Engineering — what rank would I reach?")
- Forward projection ("at current rates, which peers will overtake you and when?")

---

## Getting Started

```bash
# 1. Copy env template and fill in values
cp .env.example .env
# Required: POSTGRES_PASSWORD, GEMINI_API_KEY
# Optional: SUPABASE_URL, SUPABASE_ANON_KEY (auth)

# 2. Start Postgres
docker compose up -d postgres

# 3. Load HERD data (migrated from v1 SQLite)
python scripts/load_seed_data.py

# 4. Build and test dbt models
docker compose run --rm dbt run
docker compose run --rm dbt test

# 5. Start the API
docker compose up -d api
# Swagger UI: http://localhost:8000/docs

# 6. Start the frontend
cd frontend && npm install && npm run dev
# App: http://localhost:3000
```

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /institutions` | Search and list institutions |
| `GET /institutions/{inst_id}` | Institution detail for a given year |
| `GET /institutions/{inst_id}/rank` | National rank trend over time |
| `GET /institutions/{inst_id}/anchor` | Competitive neighborhood (institutions above/below) |
| `GET /institutions/{inst_id}/funding` | Funding source breakdown and trend |
| `GET /institutions/{inst_id}/state-rank` | State ranking and market share |
| `GET /institutions/{inst_id}/insight` | LLM-generated strategic insight |
| `GET /peers/{inst_id}` | KNN peer set (with optional classification filters) |
| `GET /peers/{inst_id}/gap` | Dollar gap vs peer average by funding source |
| `GET /peers/{inst_id}/trend` | R&D trend for institution + peers |
| `GET /peers/{inst_id}/movement` | Peer rank movement, CAGR, convergence flags |
| `GET /portfolio/{inst_id}` | Field portfolio breakdown |
| `GET /portfolio/{inst_id}/momentum` | Field growth rate vs national trend |
| `GET /federal/{inst_id}` | Federal agency breakdown |
| `GET /federal/{inst_id}/concentration` | Agency concentration vs peers |
| `POST /qa/ask` | Natural-language question answering |
| `GET /briefing/{inst_id}` | Structured narrative briefing (JSON for PDF render) |
| `GET /classifications` | Carnegie, AAU, HBCU, HSI, EPSCoR metadata |

---

## Engineering Principles

- Join on `inst_id`, never institution name — 259 institutions changed names across 15 survey years
- Never mutate source data — staging models clean, mart models transform
- Field totals must equal `total_rd`; agency sums must equal `federal` — enforced by dbt singular tests
- Positioning, not judgment — no risk labels, no "you should do X" from the data layer
- Projections are always labeled "at current growth rates" — trajectories, not predictions
- Peer matching is symmetric — if A is in B's peer set, that doesn't mean B is in A's

See [`docs/decisions.md`](./docs/decisions.md) for the full architecture decision log.
