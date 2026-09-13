# Tech Transfer Conversation Brief
**Meeting**: TechTalents — Monday**
**Purpose**: Demo, product-market fit, competitor landscape, usage potential, and IP transfer discussion

---

## How to Open the Conversation

Start with the problem, not the tool.

> "This came from a conversation with our VPR. She was trying to understand where UNT stands nationally in research expenditures and what it would take to move the needle. The data exists — NSF publishes it every year — but there was no tool that turned it into a decision. So I built one."

Give credit to the VPR for surfacing the need. That's the honest origin story, and it immediately anchors the tool in a real institutional use case rather than a side project.

---

## What the Tool Does (Demo Guide)

The tool is a web application built on NSF HERD data — the federal survey that tracks R&D expenditures at every U.S. university. It gives a Vice President for Research a decision dashboard they cannot get anywhere else.

**Walk through in this order:**

1. **Institution picker** — search for any of the ~900 reporting universities
2. **Snapshot tab** — national rank, 5-year CAGR, funding source breakdown, state rank
3. **Peer comparison** — algorithmically matched peer institutions (KNN algorithm), dollar gap to each peer, rank trajectory over time
4. **Portfolio tab** — field-level breakdown (Engineering, Life Sciences, etc.), how the institution's mix compares to peers
5. **Federal tab** — which agencies fund this institution vs. peers (NSF, NIH, DoD, etc.)
6. **Ask tab** — natural language questions ("which peers grew faster than us in the last 5 years?")
7. **Briefing export** — one-click PDF that a VPR can hand to their provost or board

The key point to make during the demo: every number is sourced directly from the NSF HERD public-use data files. Nothing is estimated or modeled. The intelligence layer is the tool — the data is the federal government's.

---

## The Market Problem (Lead With This)

**Carnegie R1 classification is determined by one number: NSF HERD expenditure.**

Not one of several inputs. The only input for the expenditure side. The 2025 Carnegie methodology is explicit: $50M in total R&D expenditures (HERD-reported) AND 70 research doctorates annually = R1. There is no other data source. The VPR's HERD number is the classification number.

Why does R1 matter?
- Faculty recruitment: top doctoral candidates and senior faculty filter job searches by Carnegie classification
- Grant competitiveness: some federal programs have R1 eligibility requirements
- Doctoral program expansion: state coordinating boards use Carnegie classification to approve new PhD programs
- Prestige and fundraising: presidents use R1 status with donors, legislators, and boards

**In Texas specifically, the stakes are financial and constitutional.** Texas Proposition 5 (2023) created the Texas University Fund — a $3.9B state endowment. Eligibility requires HERD-reported federal and private research expenditures above a threshold. UNT, Texas State, University of Houston, and Texas Tech are current recipients. The amount received is tied directly to HERD performance. A VPR who allows HERD expenditures to decline risks losing endowment distributions. This is not an abstract benchmarking concern — it is a recurring financial mechanism tied to a publicly reported federal number.

**The addressable market:**
- 139 R2 institutions currently hold that designation nationally
- 42 institutions gained R1 for the first time in the 2025 Carnegie update
- Every R2 institution above ~$30M in R&D expenditures is actively tracking the $50M threshold
- In Texas alone: Texas State ("Run to R1" presidential commission), UTRGV (built their own analytics department with a real-time tracking dashboard), UT Dallas, UTSA, and others are all in active R1 pursuit

**Every December**, when NSF releases HERD data, VPR offices across the country issue press releases, present results to boards of trustees, and update their strategic plan tracking dashboards. This is an annual, high-stakes, recurring workflow. The tool exists to serve that workflow.

---

## Why Existing Tools Don't Solve This

This is the most important thing to establish clearly. The existing commercial market answers the **wrong question**.

| Tool | Cost/year | What it measures | Answers the VPR's question? |
|---|---|---|---|
| Elsevier SciVal | $40K–$150K | Publications, citations | No — wrong data |
| Clarivate InCites | $40K–$120K | Publications, citations | No — wrong data |
| Academic Analytics | $50K–$150K | Faculty productivity, grants won | No — wrong data |
| EAB Advisory | $100K–$500K | Best practices, process benchmarking | No — qualitative only |
| Huron Consulting | $50K–$300K/project | Custom engagement | No — one-time, not self-service |
| NSF NCSES Table Builder | Free | Raw HERD data | Data yes, intelligence no |
| Streamlyne HERD Visualizer | ~$2K–$10K | Basic HERD visualization | Partially — no KNN, no narrative |

SciVal and InCites cost $40K–$150K per year and measure publications and citations. A VPR trying to grow R&D expenditure and move up in HERD rankings gets zero actionable intelligence from those tools. They answer "how does our research output compare?" — not "where do we rank in spending and what should we do about it?"

The NSF tools provide the right data but no analytical layer. Downloading CSVs, computing CAGRs manually, building peer sets in Excel — that is what most mid-tier institutions are doing today, if they do it at all.

**The gap that this tool fills:**
- Algorithmic peer matching (KNN based on institutional characteristics) — no existing tool does this
- CAGR and rank trajectory pre-computed and visualized — not available in NSF tools
- Field-level gap analysis vs. peers — not available anywhere
- Narrative export for provosts and boards — no existing tool generates this
- Free and open — accessible to R2 institutions that cannot afford $80K/year for SciVal, which wouldn't answer their question anyway

---

## What We Are Asking From Tech Transfer

**What we're transferring:**
- The full application codebase (data pipeline, API, frontend)
- The KNN peer-matching algorithm
- The narrative briefing generation logic
- The dbt transformation models

**What we are asking for in return:**
- The right to present this work at national conferences (NCURA, SRA International) under my name as the creator
- The right to be publicly credited as the inventor in any UNT communications about the tool
- VPR office involvement in spreading it to peer institutions and facilitating introductions
- Letters from pilot institution VPRs documenting the tool's role in their strategic planning

**What we are NOT asking for:**
- Revenue share or royalties
- Control over future development decisions
- Anything that complicates UNT's use of the tool

The goal is visibility and documented adoption — not commercialization. Once UNT officially holds this tool, the VPR has an institutional incentive to share it with her network of peer VPRs. That creates a natural distribution channel and makes the recommendation letter pipeline organic rather than requiring cold outreach.

---

## IP and Attribution: Questions That Will Come Up

**"Was this built with AI assistance?"**

Yes. AI-assisted development tools (Claude Code) were used during development, the same way developers use GitHub Copilot, Stack Overflow, or any framework. The intellectual contribution — the product concept, the KNN benchmarking algorithm, the architecture, the data pipeline design, the decisions about what to build and why — is mine. AI coding tools are not co-authors with IP claims. This is standard practice in modern software development.

**"Where does the data come from?"**

Entirely from NSF HERD public-use data files — U.S. government works in the public domain. No licensed third-party data is involved. There is no data licensing problem. The data is freely available; the analytical layer built on top of it is the contribution.

**"What are the data limitations?"**

HERD data lags by approximately 17–18 months from fiscal year end to public release. The most recent available data is FY2023 (as of early 2025). This is a known feature of the dataset, not a flaw in the tool. All peer institutions face the same lag, so benchmarking comparisons remain valid. The tool includes a disclosure note on the data currency wherever rankings are displayed. VPRs understand this lag because they file the survey themselves.

---

## Hosting and Deployment Plan

The tool currently runs locally via Docker Compose (Postgres + FastAPI + Next.js). For a multi-institution pilot, the plan is to host it on UNT-approved infrastructure — Azure is the preferred path given UNT's existing Microsoft relationship.

**What is needed before any external pilot:**
1. Basic authentication so access is controlled (IT security requirement)
2. A hosted URL — institutions get a URL, not deployment instructions
3. A one-page data provenance document: data source, what leaves the network (Gemini API calls for narrative generation), update frequency

The VPR's backing on the IT approval process is noted. If UNT IT requires Azure deployment, that is achievable. The codebase is containerized and can be deployed to Azure Container Apps or Azure App Service without architectural changes.

---

## The Bigger Picture: Why This Matters Beyond UNT

The research offices that most need this tool are the ones with the least capacity to build it themselves. Large R1 flagships (Michigan, Wisconsin, Georgia Tech) have dedicated research analytics teams that build internal Tableau dashboards. Mid-tier R2 institutions with R1 aspirations — the 100+ institutions actively tracking the Carnegie threshold — typically have one or two IR analysts who download HERD CSVs and build spreadsheets when a specific question arises.

A free, open, institutionally hosted tool that gives those VPRs the same analytical capability as the well-resourced R1 offices is a genuine equity contribution to the research administration field. That framing matters both for the tech transfer conversation and for how it gets positioned at NCURA and SRA International.

---

## After Monday: Immediate Next Steps

1. **Confirm the IP transfer structure in writing** — specifically: creator credit rights, right to present at conferences, VPR facilitated introductions to pilot institutions
2. **Identify 2–3 pilot institutions** through VPR's network — prioritize R2 institutions in active R1 pursuit (Texas State, UTRGV, and one out-of-state institution for geographic diversity)
3. **Stand up hosted version** on UNT-approved infrastructure before any pilot begins
4. **Submit abstract to NCURA Annual Meeting** — deadline typically early spring; title: "Open-Source R&D Positioning Intelligence: Making NSF HERD Data Actionable for Research Offices"
5. **Draft one-page data provenance document** for IT security review at pilot institutions
6. **Request a letter from UNT's VPR** — not a testimonial, a specific letter describing the tool's role in UNT's research strategic planning and why existing commercial products did not meet this need

---

## One-Sentence Version (If You Need It)

> "We built the only free, open-source tool that turns NSF HERD data into decision intelligence for VPRs — algorithmic peer matching, rank trajectory, field-level gap analysis, and a provost-ready briefing — and we want UNT to own it so the VPR can spread it through her network."
