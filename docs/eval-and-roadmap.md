# HERD v2 × Federal Radar — Evaluation & Roadmap

*Prepared 2026-07-13. Analysis only. Where the code contradicts a project's own
status notes, I trust the code and flag it.*

---

## The one idea to hold onto

Two tools, same buyer, different **grain**:
- **HERD v2** = institution-year grain. "UNT, FY2024, $178M total R&D." → *how big are we, are we moving vs. peers.*
- **Federal Radar** = award grain. "This NSF grant, this PI, this program, $1.2M." → *in this program, who's winning, are we in the room.*

Everything below follows from that difference.

---

## 1. IP flag (raise first, don't build past it)

Both tools were built partly on institution-specific inputs (UNT peer lists, meetings) and partly on personal time; the goal is licensing via the tech transfer office (TTO). **Settle ownership with the TTO before building multi-tenancy** — genericizing raises the value of an asset whose ownership is unclear. Not legal advice; a sequencing call. Doesn't block analysis; gates the build (Checkpoint 0).

---

## 2. What actually exists (two corrections)

- **Features 2 & 3 are already built.** HERD v2's `mart_peer_movement` (rank delta, CAGR, convergence flag) and `mart_trajectories` (forward projection, correctly labeled "at current growth rates") exist and are tested in dbt. CLAUDE.md says they're deferred pending DuckDB — **wrong; they only need an API endpoint + UI.** Only Feature 1 (live slider re-ranking) has any DuckDB case, and even that is fine in Postgres at ~1,000 rows.
- **Radar already has dynamic peers.** `get_dynamic_peers()` exists — but it's 1-D (nearest by total award $) vs. HERD's 7-feature KNN. So it's not "two fixed peer sets only."

---

## 3. Product gap (PMF)

**Served today:** VPR / AVP-Research / Sponsored Programs — analysts who want the drill-down. Real fit.

**Underserved — and it's not a data gap, it's an *altitude* gap.** Everyone gets the same drill-down and must *pull* it:
- **Provost / Board** need a *pushed* one-paragraph "ahead or behind, changing?" — not a dashboard.
- **Deans** need *their college's* slice, not the whole institution (Radar's award grain fits this best).
- **IR / planning** need methodology + export.

Altitude = a scope+format transform over the same data (`scope = institution|college|program`, `format = table|slice|paragraph`), not three products — *once the data is unified*.

**Highest impact-to-effort item:** Carnegie/AAU threshold reframe. HERD topline $ *is* the raw material for R1/AAU. "You're $23M below the R1 threshold" / "3 peers passed you into the top 100" lands with provosts/boards far harder than "rank #147." Cheap reframe of data on hand. Caveat: Carnegie uses more than R&D $ — frame as "distance on the R&D component, [vintage]," descriptive not predictive.

**The real missing product is a push/briefing layer**, not any one feature — one engine (provost, board, advancement, gov-relations) off unified marts.

---

## 4. Architecture (constraint: most *legible* for a solo owner, not most impressive)

1. **One database, keep two pipelines.** Land Radar's award data in HERD's Postgres as raw sources; **keep Radar's Python fetchers** (dbt transforms, it doesn't ingest); model with dbt from there. One warehouse with dbt tests is more *diagnosable* than two codebases — worth the one-time dbt learning tax. **Skip DuckDB.**
2. **Crosswalk is sufficient.** Bridge = IPEDS `unitid`: HERD `inst_id → unitid` (in `stg_institution_classifications`) → Radar `unitid → awards_uei`. To verify: `inst_id→unitid` coverage; graceful "no award data" state; map `unitid → set of UEIs` (dual-UEI schools).
3. **"Peer" means two different things — keep both.** HERD KNN = *topline-spend* peer (similar budgets). Award competitiveness needs a *program-competitor* peer (who bids the same grants) — two schools can be spend-peers and never compete. Don't collapse them; label which is which. Retire Radar's weak 1-D peer finder.
4. **Genericizing is config + UI, not a data rebuild.** Move `is_my_institution` / peer flags out of tables into per-tenant config; wire Radar's existing picker into the UI; HERD's KNN gives new customers a default peer set free. Data layer is already institution-agnostic.
5. **Converge on Next.js — last, gradually.** Streamlit is easier for a solo owner, but two frontends is the worst option. Next.js wins on the briefing/PDF/multi-tenant direction and already talks to FastAPI. Move Radar's views over one page at a time; retire Streamlit last.

---

## 5. Roadmap (go/no-go checkpoints, not a task list)

🟢 low · 🟡 med · 🔴 high effort · ★ high impact

| # | Checkpoint | Effort | Gate / why |
|---|---|---|---|
| **0** | **TTO / IP conversation** ★ | 🟢 | Do before multi-tenancy. Blocks Checkpoint 4+; 1–3 can proceed meanwhile. |
| **1** | **Surface movement + projection** (endpoint+UI for the built marts) ★ | 🟢🟡 | Best impact-to-effort. Verify marts on 2–3 known institutions first. |
| **2** | **Carnegie/AAU threshold reframe** ★ | 🟢 | Pick threshold source/vintage; keep it descriptive. |
| **3** | **Data-model consolidation** (Radar → Postgres/dbt) ★ | 🔴 | **Prerequisite for all combined features.** Preserve per-source `awd_amount`; audit the bridge. |
| **4** | **Push briefing layer** (award-fed, provost/board) ★ | 🟡🔴 | Needs #3. Decide manual vs. scheduled send. |
| **5** | **Genericize off UNT single-tenancy** ★ | 🔴 | Hard-gated on #0. Decide multi-tenant app vs. per-customer deploys. |
| **6** | **Two explicit peer definitions** | 🟡 | Validate framing with a real AVP-Research first. |
| **7** | **Frontend convergence** (Streamlit→Next.js, gradual) | 🔴 | Needs #3. Each page its own go/no-go; no big-bang. |
| **8** | **Dean / college slice** | 🔴 | Decide field↔college mapping; validate with one dean. |

---

## Bottom line

1. **Two "future" features already exist** — surface them (Checkpoint 1), don't rebuild.
2. **The gap is altitude + delivery, not analytics** — a pushed briefing serves the underserved personas off one engine.
3. **Consolidate data, keep ingestion, skip DuckDB** — one tested Postgres warehouse is the most diagnosable setup; gate the build on the IP conversation.

*Verify: `inst_id→unitid` coverage (§4.2), mart correctness on real institutions (Checkpoint 1), Carnegie threshold vintage (§3).*
