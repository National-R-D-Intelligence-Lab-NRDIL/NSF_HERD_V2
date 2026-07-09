# NSF HERD v2 — Learning Notes

> Concepts explained in plain language as the project is built. Organized by topic for easy scanning.

---

## The Problem Phase 1 Solved

v1 stored all the HERD data in a SQLite file — basically a spreadsheet on disk. It works fine when only one thing is reading it at a time. But v2 needs multiple things (the API, dbt, DuckDB) all reading from the same data simultaneously. SQLite can't do that reliably.

So Phase 1 swaps it out for **Postgres** — a real database server built for exactly that. Multiple things can connect to it at the same time, from different places, without conflict.

---

## Why WSL2 Was Needed First

Before Docker could run on Windows, we had to install **WSL2 — Windows Subsystem for Linux 2**.

Docker requires Linux to work. On a Mac, Linux is already under the hood. On Windows, it isn't. WSL2 is Microsoft's way of running a real Linux system quietly inside Windows — not a fake version, a real one.

So the setup order was:
1. Install WSL2 → gives Windows a Linux layer
2. Install Docker Desktop → runs inside that Linux layer
3. Run containers → they run on the Linux layer that WSL2 provides

Without WSL2, Docker Desktop won't start on Windows.

---

## What is Docker?

Docker is software you install on your machine — like any other app. On Windows and Mac, the version most people use is called **Docker Desktop**.

Once installed, Docker gives you the ability to run pre-packaged environments called **containers** without manually installing anything inside them.

**The one-liner:**
> Docker ships a mini Linux computer inside your Windows machine. Everything runs in there. Your actual system stays untouched.

---

## How Docker Actually Works

When you install Docker Desktop, it quietly sets up a lightweight **Linux virtual machine (VM)** inside your Windows machine. Think of it as a computer running inside your computer.

All containers live and run inside that VM — not directly on Windows.

So when you run a Postgres container:
- Docker downloads Postgres from the internet (from Docker Hub — more on that below)
- Installs and runs it **inside the Linux VM**
- Your Windows system never has Postgres on it directly

**Why this matters:**
- Your Windows machine stays clean — no leftover files, no version conflicts
- You can run 10 different projects with 10 different Postgres versions at the same time, each isolated, none interfering with each other
- When you stop a container, it's completely gone from running — no residue

---

## How Docker Fetches Things from the Internet

**Docker Hub** is basically an app store for pre-built environments. It's a website that stores official packages (called **images**) for Postgres, Python, Node, and thousands of other tools.

When Docker sees `image: postgres:16` in your config file, it:
1. Goes to Docker Hub over the internet
2. Downloads the official Postgres 16 image
3. Runs it inside the VM

After the first download, Docker caches the image locally — so you don't re-download it every time you start the container.

**Image vs Container:**
- **Image** — the blueprint (downloaded once, stored locally)
- **Container** — a running instance of that blueprint (you can start and stop it)

---

## Where Does Docker Store Things?

Docker manages its own storage inside the VM. You won't find a "Postgres folder" in Windows Explorer — Docker controls it, not you.

But data inside a container disappears when the container stops. To persist data (like your database), you use a **volume** — a storage area that Docker manages separately from the container itself. Even if the container stops or gets deleted, the volume (and your data) survives.

In this project, the volume is called `pgdata`. It holds all the Postgres data files so the database survives restarts.

---

## What is YAML?

YAML is just a way to write structured information in a human-readable format. Think of it as a cleaner version of JSON — same idea (key-value pairs, nested structure), just without all the curly braces and quotes.

```yaml
# YAML
name: postgres
version: 16
```
```json
// Same thing in JSON
{"name": "postgres", "version": "16"}
```

That's it. YAML is just the format of the file. Docker happens to use YAML for its compose files.

---

## Docker Compose and the YAML File

**Docker Compose** is the tool that lets you define and manage multiple containers using a single config file — `docker-compose.yml`. One command (`docker compose up`) reads the file and starts everything defined in it.

Right now there's one container (Postgres). By the end of the project there will be several (Postgres + API + Dagster) — all defined in the same file, all starting together.

### The three sections of a docker-compose.yml

**`services`** — what you want to run. Each service is one container.

Inside each service you define:
| Key | What it does |
|---|---|
| `image` | What to download from Docker Hub |
| `environment` | Config values passed into the container (username, password, etc.) |
| `ports` | Maps a port on your machine to a port inside the container. `5432:5432` means your laptop's port 5432 connects to the container's port 5432 |
| `volumes` | What to persist or share between your machine and the container |
| `healthcheck` | How Docker knows the service is truly ready, not just started |

**`volumes`** — declares persistent storage that lives outside the container. You declare the volume name here, then reference it inside a service. Without this, data disappears when the container stops.

**`networks`** — how services talk to each other. Not defined explicitly here because Docker Compose creates a default network automatically. When the API service is added later, it will use this default network to reach Postgres by just using the service name (`postgres`) as the hostname.

---

## What is the pgdata Volume?

Imagine a Docker container like a **paper cup**. When you throw the cup away (stop or restart the container), everything inside is gone.

A **volume** is like giving that paper cup a permanent slot in a filing cabinet. The data lives in the filing cabinet, not in the cup. You can throw the cup away and get a new one — the filing cabinet still has all your data.

`pgdata` is just the name we gave that filing cabinet. It could be called anything. We called it `pgdata` because that's the conventional name (pg = Postgres, data = data).

Without `pgdata`, every time you restarted Docker, all 300,000 rows of HERD data would vanish.

---

## What is a Port?

Think of your computer like an **apartment building**. The building has one address (your IP address), but inside there are hundreds of apartments, each with a number. Different services live in different apartments.

A **port is just an apartment number.** It tells your computer which service a message is meant for.

Port 5432 is Postgres's standard apartment number — it's been that way for decades, like how websites are always port 80.

When the compose file says:
```yaml
ports:
  - "5432:5432"
```

That means: forward traffic from apartment 5432 on your laptop to apartment 5432 inside the Docker container.

Without this line, Postgres is running but completely isolated inside Docker. Nothing outside — not your Python script, not dbt, nothing — can reach it. The ports line opens a door between your laptop and the container.

```
Your laptop
│
├── Port 5432 open ──────────────→ Docker container (herd_postgres)
│                                        │
│                                        ├── Postgres is running
│                                        │
│                                        └── pgdata volume ──→ Filing cabinet
│                                                               (data survives
└── load_seed_data.py                                           restarts)
    connects to localhost:5432
```

---

## Environment Variables and Secrets (.env)

Passwords and API keys are never hardcoded into files that get committed to GitHub. Instead they live in a `.env` file that stays on your machine only.

- `.env.example` — committed to GitHub, shows what variables exist but has no real values
- `.env` — never committed, has your actual passwords and keys
- `.gitignore` — tells Git to ignore `.env` so it can never accidentally be pushed

The app reads from `.env` automatically. When you deploy to Railway, you set the same variables in Railway's dashboard instead of a file.

---

## The Schema vs. the Data — Two Separate Files

A common point of confusion in Phase 1: two files touch the database, and they do different things.

**`scripts/seed.sql`** — defines the *structure*. It says "create a table called `raw_institutions` with these columns and these types." It runs automatically when Docker starts Postgres for the first time. After this, the tables exist but are completely empty.

**`scripts/load_seed_data.py`** — fills in the *data*. It opens the old `herd.db` SQLite file, reads all the rows, and inserts them into the empty Postgres tables. You run this manually once.

Think of it like building a house vs. moving your furniture in. `seed.sql` builds the house. `load_seed_data.py` moves the furniture.

---

## How load_seed_data.py Found the SQLite File

The script didn't ask you where `herd.db` was. It had a **default path hardcoded** at line 85:

```python
default = "../../nsf-herd-mvp/data/herd.db"
```

This means: starting from where the script lives, go up two folders, then look for `nsf-herd-mvp/data/herd.db`. It assumed your two projects sit next to each other on your machine — and they do:

```
C:/Users/kalya/
├── nsf-herd-mvp/
│   └── data/
│       └── herd.db     ← found here automatically
└── nsf-herd-v2/
    └── scripts/
        └── load_seed_data.py
```

If your folders were laid out differently, you'd pass the path manually: `python load_seed_data.py --sqlite path/to/herd.db`.

---

## The Password @ Bug

When code connects to a database, it can pack all the connection details into a single URL string:

```
postgresql://username:password@host:port/database
```

The `@` symbol is the separator — it marks where the password ends and the host begins.

The original script built this URL using your actual password (`K@ly@n8358`), producing:

```
postgresql://herd:K@ly@n8358@localhost:5432/herd_db
```

Now there are three `@` signs. Postgres tried to parse it and got confused — it read the host as `ly` and the rest as nonsense.

The fix: stop using the URL format. Pass each piece separately as a keyword argument:

```python
psycopg2.connect(
    host="localhost",
    port=5432,
    user="herd",
    password="K@ly@n8358",
    dbname="herd_db"
)
```

No URL parsing, no ambiguity. The `@` in the password is just a regular character.

---

## Phase 1 — What Was Built (Summary)

| File | What it does |
|---|---|
| `docker-compose.yml` | Defines and runs the Postgres container |
| `scripts/seed.sql` | Creates the 3 database tables automatically on first startup |
| `scripts/load_seed_data.py` | One-time migration of ~300K rows from v1 SQLite into Postgres |
| `.env.example` | Template for all config values and secrets |
| `.gitignore` | Prevents secrets from being committed to GitHub |

**End state:** Run `docker compose up` → Postgres is live with all HERD data loaded, ready for everything built in Phases 2–7.

---

---

---

# Phase 2 — dbt Core

---

## What is dbt and Why Does It Exist?

dbt stands for **data build tool**. At its core, it just runs SQL files. That's it.

Before dbt, if you wanted to transform raw data into something useful, you'd write Python scripts or one giant SQL query. Both work. But they're hard to test, hard to document, and hard to maintain as they grow.

dbt solves this by treating your SQL transformations like software code — with version control, tests, documentation, and automatic dependency tracking built in.

**The one-liner:**
> dbt = write SQL files, dbt handles the rest (order, testing, documentation)

---

## dbt is the Instruction Manual Between Raw Data and the API

The raw data sitting in Postgres is just numbers. It has no rankings, no growth rates, no peer comparisons. Something has to compute those things. dbt is that something.

```
Raw tables (Postgres)
        ↓
    dbt staging        ← cleans and standardizes
        ↓
    dbt marts          ← computes rankings, CAGR, projections
        ↓
    FastAPI (Phase 3)  ← serves results to the frontend
```

dbt sits in the middle. It takes dirty raw data in, produces clean analytical tables out.

---

## dbt is Just CTEs Spread Across Files

If you've written SQL before, you've written CTEs (Common Table Expressions) — the `WITH` blocks at the top of a query:

```sql
WITH cleaned AS (
    SELECT * FROM raw_institutions WHERE year BETWEEN 2010 AND 2024
),
ranked AS (
    SELECT *, RANK() OVER (PARTITION BY year ORDER BY total_rd DESC) AS national_rank
    FROM cleaned
),
with_cagr AS (
    SELECT *, -- growth rate math --
    FROM ranked
)
SELECT * FROM with_cagr
```

dbt is literally that — except each CTE becomes its own `.sql` file:

```
stg_institutions.sql    ← the "cleaned" CTE
mart_rankings.sql       ← the "ranked" CTE
mart_peer_metrics.sql   ← the "with_cagr" CTE
```

Same logic. Just spread across files instead of stacked in one query. Every concept you already know from writing SQL still applies.

---

## "But I Could Just Create Views in the Database"

This is the right question to ask. You could. Create a `business` schema, define each transformation as a view, chain them together, alter any view when logic changes. That works. Senior SQL developers did exactly this before dbt existed.

So what does dbt actually add?

**1. The dependency is in the code, not in your head**

With manual views, if someone drops view A to rebuild it, view B silently breaks — and nobody knows until a query fails. With dbt, every `ref()` call documents the dependency explicitly in the file itself.

**2. Tests run automatically**

With manual views, you'd write and run test queries yourself. With dbt, `dbt test` runs all checks in one command. In CI/CD (Phase 6), this runs automatically on every code push — so bad data never reaches the API silently.

**3. Rebuild everything from scratch in one command**

`dbt run` recreates every view and table in the correct dependency order. If the database gets wiped, one command restores the entire transformation layer. With manual views, you'd have to remember the correct order yourself.

**4. Documentation is generated automatically**

`dbt docs generate` produces a website showing every model, every column, every dependency. With manual views, that knowledge lives in someone's head.

**The honest summary:** dbt and manual views produce the same SQL output in Postgres. The difference is that dbt makes the structure, dependencies, and tests explicit and automated — so the system doesn't depend on one person remembering how it all fits together.

For a solo project, the real payoff comes in Phase 5 (Dagster) and Phase 6 (CI/CD) — Dagster reads the dbt dependency graph and builds a visual pipeline from it automatically. GitHub Actions runs `dbt test` on every push. Those integrations are why dbt is worth using here.

---

## How dbt Figures Out the Dependency Order

When you write `{{ ref('stg_institutions') }}` in a model, dbt doesn't just substitute the table name. It **registers that dependency** while parsing all your files before running anything.

dbt reads every `.sql` file, finds every `ref()` call, and builds a map:

```
mart_rankings        needs → stg_institutions
mart_peer_metrics    needs → mart_rankings
mart_trajectories    needs → mart_peer_metrics
mart_field_portfolio needs → stg_institutions, stg_field_expenditures
```

From that map it draws a dependency graph and knows the only valid execution order. You never wrote that order anywhere — it was inferred from the `ref()` calls in the SQL files themselves.

With manual views, **you** are the dependency tracker. With dbt, the SQL files are.

---

## Two Layers: Staging vs. Marts

### Staging (created as views)

Three SQL files that clean the raw data — one per raw table:

- `stg_institutions` — replaces NULLs with 0, filters to 2010–2024
- `stg_field_expenditures` — same for field data
- `stg_agency_funding` — same for agency data

These are **views** — not tables stored on disk. A view is a saved SQL query. Every time something reads from it, the query runs fresh against the raw table. Think of staging like washing vegetables before cooking. You're not changing what the vegetable is — just cleaning it.

**Rule:** Staging models only clean. They never compute business logic. No rankings, no growth rates, nothing derived.

### Marts (created as tables)

Five SQL files that compute actual business logic on top of staging:

| Mart | What it computes | Rows |
|---|---|---|
| `mart_rankings` | National + state rank per institution per year | 10,084 |
| `mart_field_portfolio` | Each institution's R&D by field as % of total | 70,426 |
| `mart_peer_metrics` | CAGR (growth rate) and rank change over 5 years | 681 |
| `mart_peer_movement` | Which institutions are climbing fast (convergence signals) | 681 |
| `mart_trajectories` | Projected R&D totals 1, 2, 3 years forward | 681 |

These are stored as real **tables** — pre-computed and saved to disk. The API reads from these directly. Fast lookups, no re-computation on every request.

**Why tables and not views for marts?** Views recompute every time they're queried. For a single lookup that's fine. But ranking 10,000 institutions is expensive — you don't want to redo that work on every API call. Storing the result as a table means the work is done once at `dbt run` time.

---

## What the 40 Tests Do

Tests in dbt are SQL queries that should return **zero rows**. If they return any rows, the test fails — something is wrong with the data.

Three types we used:

**Generic tests (in YAML files)** — one-liners applied to columns:
- `not_null` — no nulls allowed in this column
- `accepted_values` — only these specific values are valid
- `unique` — no duplicate values

**Singular tests (custom SQL files)** — the three data invariants from the project spec:
- Field totals must equal total_rd per institution/year
- Agency sums must equal federal funding per institution/year
- Sub-field totals must equal their parent field total

All 40 tests returned 0 rows — the data is consistent.

---

## The CAGR Macro

CAGR = Compound Annual Growth Rate. The formula for how fast something grows per year, accounting for compounding:

```
CAGR = (end_value / start_value) ^ (1 / years) - 1
```

Instead of copy-pasting this formula into every mart model that needs it, we wrote it once as a **macro** — dbt's version of a reusable function — in `macros/cagr.sql`. Every mart that needs a growth rate calls `{{ cagr(...) }}`.

One formula, one place to change it if needed.

---

## Bugs Hit in Phase 2 (Worth Knowing)

**Bug 1: dbt-core 2.0 doesn't support Postgres**

Installing `dbt-postgres==1.8.2` automatically pulled in `dbt-core 2.0.0a2` (a new alpha version). That version dropped Postgres support. Fix: explicitly pin both packages — `dbt-core==1.8.2` and `dbt-postgres==1.8.2`.

Lesson: always pin your package versions. Letting pip choose the latest can break things silently.

**Bug 2: ROUND() in Postgres requires NUMERIC, not FLOAT**

The CAGR formula uses `POWER()`, which returns a `double precision` (float). Postgres's `ROUND()` function only accepts `numeric` type — not float. Fix: cast the result to `::NUMERIC` before passing it to `ROUND()`.

Lesson: Postgres is strict about types in ways that other databases aren't.

---

## Phase 2 — What Was Built (Summary)

| File | What it does |
|---|---|
| `dbt/dbt_project.yml` | Project config — names, paths, default year window |
| `dbt/profiles.yml` | Postgres connection using env vars |
| `dbt/macros/cagr.sql` | Reusable CAGR formula |
| `dbt/models/staging/stg_*.sql` | 3 staging views — clean raw data |
| `dbt/models/staging/_staging.yml` | Source definitions + column tests |
| `dbt/models/marts/mart_*.sql` | 5 mart tables — computed analytics |
| `dbt/models/marts/_marts.yml` | Schema + tests for mart models |
| `dbt/tests/assert_*.sql` | 3 data invariant tests |
| `dbt/Dockerfile` | Runs dbt inside Docker, no local install needed |

**End state:** `docker compose run --rm dbt run` builds all 8 models. `docker compose run --rm dbt test` runs all 40 tests. 0 failures.

---

## Deployment Note

`docker-compose.yml` is a local development tool. When the app goes live (Railway, etc.), the services get split apart:
- Postgres → Railway managed database
- API → Railway service
- Frontend → Vercel

Docker Compose stays as the local dev environment. The same containers that run locally run in the cloud — that's the whole point. No "it worked on my machine" problems.

---

---

# Q&A — Clarifications and Corrections

> Questions asked during the build, answers and corrections in plain language.

---

## "dbt is the replacement for ETL" — Close, but not quite

**Correction:** dbt replaces the **T** in ETL, not the whole thing.

- **Extract** (pulling data from a source) — still done separately
- **Load** (putting it into the database) — still done separately, `load_seed_data.py` did this
- **Transform** (cleaning and computing) — this is what dbt handles

The industry renamed it **ELT** for this reason — you Extract, Load first, then Transform inside the database. dbt only touches data that's already landed in the database.

---

## "The .py file defines the schema" — Not quite

**Correction:** Two files touch the database in Phase 1, and they do different jobs:

- `seed.sql` — defines the structure (columns, types, primary keys). Creates the empty tables.
- `load_seed_data.py` — fills the tables with data. Knows the column names but does not create anything.

`load_seed_data.py` is not the schema. It's the moving truck. `seed.sql` built the house first.

---

## "We specified where to find the SQLite file" — It was hardcoded

**Correction:** You didn't specify anything. The path to `herd.db` was hardcoded in the script as a default, assuming your two project folders sit next to each other on your machine. It happened to match, so it worked automatically. If your folder structure was different, you'd have needed to pass the path manually.

---

## How does dbt connect to Postgres?

dbt reads `profiles.yml` for the connection details — host, port, username, password, database name. Same concept as a connection string in SSMS or Power BI. Every time you run `docker compose run --rm dbt run`, dbt opens a connection to Postgres, compiles your SQL files, sends them to Postgres, and Postgres does the actual execution.

**dbt never runs SQL itself. It compiles and hands off to Postgres.**

---

## What does `{{ source('herd', 'raw_institutions') }}` mean?

Three parts:

- `{{ }}` — Jinja templating. dbt processes anything inside these before sending SQL to Postgres.
- `source()` — a dbt function for referencing raw tables you didn't build yourself.
- `'herd'` — the source group name, defined in `_staging.yml`. `'raw_institutions'` — the actual table name.

dbt replaces the whole thing with `public.raw_institutions` before Postgres ever sees it.

**Rule:** Use `source()` for raw tables you don't own. Use `ref()` for dbt models you built.

---

## Do you have to write the YAML file from scratch?

Yes, but it's repetitive and predictable — everyone copies a previous project's YAML and changes the names. The minimum viable version is just pointing dbt at your tables:

```yaml
sources:
  - name: herd
    schema: public
    tables:
      - name: raw_institutions
```

Add column tests later as you learn which columns matter. You don't need to document everything upfront.

---

## Where do you run dbt commands? In Docker or the terminal?

In your **terminal**, from the `nsf-herd-v2` folder. Docker handles the rest invisibly.

```bash
docker compose run --rm dbt run     # builds all models
docker compose run --rm dbt test    # runs all tests
```

`dbt run` doesn't show you data — it just builds the tables. To see data, use a GUI tool (DBeaver) or query directly with psql.

---

## What does `--rm dbt run` mean?

It's three separate pieces:

| Piece | Meaning |
|---|---|
| `--rm` | Delete the container after it finishes (no cleanup needed) |
| `dbt` | The service name in docker-compose.yml — which container to start |
| `run` | The command passed to dbt inside the container (`dbt run`) |

Full translation: "Start the dbt container, run `dbt run` inside it, delete the container when done."

---

## Postgres has no UI — how do you see the data?

**Correct.** Postgres is just the engine. It has no visual interface — same as SQL Server without SSMS. You need a separate GUI tool that connects to it.

| Tool | Notes |
|---|---|
| **DBeaver** | Free, open source, connects to Postgres, SQL Server, Fabric, everything. Best choice. |
| **TablePlus** | Cleaner UI, free tier available |
| **pgAdmin** | Postgres-specific, free, but clunky |

DBeaver is the recommendation — one tool that works for this project, your work databases, and Microsoft Fabric all at once.

---

## Where is the data download step? (The v1 transcript folder)

v1 had scripts that downloaded raw CSVs from the NSF website, ran ETL, and loaded them into SQLite. In v2, that step has not been built yet.

**What we did instead in Phase 1:** copied already-transformed data from v1's `herd.db` directly into Postgres. A shortcut — intentional, to get the database working fast so Phases 2–4 could be built.

**Where it will live in v2:**

```
ingestion/
└── herd_pipeline.py    ← dlt pipeline (replaces v1 download scripts)
```

**When:** Phase 5 (Dagster). dlt handles the download from NSF, Dagster orchestrates the full pipeline — dlt first, then dbt.

**The v1 to v2 mapping:**

| v1 script | v2 replacement |
|---|---|
| `1_download.py` | `ingestion/herd_pipeline.py` (dlt) |
| `2_transform.py` | `dbt/models/staging/` (SQL) |
| `3_load.py` | dlt loads directly into Postgres |

Until Phase 5, the pipeline is not truly end-to-end. The data is correct — it came from v1 which already validated it — but fresh downloads from NSF aren't automated yet.

---

## Can dbt be used at work on Microsoft Fabric?

Yes. The adapter is called `dbt-fabric` and is maintained by Microsoft's own engineering team — it's a first-class integration, not a third-party hack.

dbt stays inside your environment — it doesn't move data anywhere external. IT/compliance concern is the same as any SQL client connecting to Fabric.

**How to start at work:**
1. Pick one dashboard — burn rate is a good first candidate
2. Refactor the big query into named CTEs first (no new tools yet)
3. Move each CTE into its own dbt model file
4. Point Power BI at the dbt mart tables — the dashboard doesn't change

**The argument that lands in compliance-heavy orgs:**
> "Right now if I get hit by a bus, nobody knows how these 600-line queries work. dbt makes that explicit, documented, and testable. It's a risk reduction."

---

## How do you learn to write dbt?

It's 90% plain SQL you already know. The only new thing is:
- `{{ ref('model_name') }}` — reference another dbt model
- `{{ source('group', 'table') }}` — reference a raw table
- YAML files for tests — structured English, not code

Start by reading the models built in this project. Try changing one small thing and running `dbt run`. The error messages are helpful. `docs.getdbt.com` is well written for the rest.

---

# Phase 3 — FastAPI

## What is FastAPI, and where does it sit?

Postgres holds data. dbt transforms it into marts. Neither of those can be reached from a browser or a phone app directly — a database doesn't speak HTTP. FastAPI is the layer that wraps SQL queries in URLs, so anything that can make a web request (a React frontend, curl, another script) can ask for data without knowing SQL at all.

```
Postgres (data) → FastAPI (HTTP endpoints) → Frontend (or curl, or anything)
```

This confirms something you asked earlier and got right: in v1, Streamlit read `herd.db` directly — the UI and the database logic were mixed in one file. In v2, the database is never touched by anything except FastAPI. The frontend (built later) will only ever call FastAPI endpoints, never the database directly.

## Why the routers turned out to be short

Compare: v1's `get_rank_trend()` ran `RANK() OVER (PARTITION BY year ...)` from scratch on every single call. In v2, `GET /institutions/{id}/rank` is just:

```sql
SELECT year, national_rank, total_rd FROM mart_rankings WHERE inst_id = $1 AND year BETWEEN $2 AND $3
```

No `RANK()`, no window function — because dbt already computed `national_rank` into a table back in Phase 2. This is the actual payoff of doing the dbt work first: the API layer becomes "look up a precomputed answer" instead of "recompute the answer every time someone asks." A busy production app might get the same rank question 10,000 times a day — better to compute it once (`dbt run`) than 10,000 times (once per request).

## The KNN peer-matcher, ported

`benchmarker.py` (v1) uses a machine learning technique (K-Nearest Neighbors) to find "similar" universities based on funding size and mix. This is **not** something dbt can do — dbt is for SQL aggregation, not fitting statistical models. So this file ported over almost unchanged, just swapping the data source from SQLite to Postgres.

One important design point carried over from v1 and reinforced in CLAUDE.md: **"cache reads, never writes — benchmarker is fitted once at API startup."** Fitting the KNN model means feeding it all ~680 institutions and letting it build an internal index — that takes a moment. Doing that on *every single request* would be wasteful and slow. Instead, it's fit once when the API container starts, stored in memory (`app.state.benchmarker`), and every request afterward just asks the already-built model a question, which is fast.

## Async, and why `time.sleep()` was a bug

FastAPI is **async** — meaning while one request is waiting on something slow (a database query, a call to Google's Gemini API), the server can work on other requests instead of just sitting idle. This only works if every "waiting" step uses `await` instead of a normal blocking call.

While building the QA feature, `time.sleep(2)` (a normal blocking pause, used for retry backoff) was written inside an `async def` function. That's a bug: `time.sleep()` freezes the *entire* server, not just the one request — every other user's request would stall too. The fix was `await asyncio.sleep(2)`, which pauses only that one request and lets the server keep serving everyone else in the meantime. This is a common mistake when learning async programming — the code runs fine in testing (only one request at a time) and only breaks under real concurrent load.

## The natural-language Q&A feature

`POST /qa/ask` is a straight port of v1's `ask()` pipeline, and it's a good example of a common LLM application pattern called **text-to-SQL**:

1. You ask a question in English ("Which Texas schools grew faster than us?")
2. The question + a description of the database schema + some example Q&A pairs get sent to Gemini
3. Gemini writes a SQL query (not an answer — a query)
4. The API runs that SQL against Postgres directly
5. The results + your original question go back to Gemini one more time, asking it to summarize the results in plain English

The LLM never sees your actual data until step 4 runs and returns results — it only sees the *shape* of the database (table names, column names, valid codes) and writes SQL blind. This matters for accuracy: if a query returns 0 rows, the app tries once more, telling Gemini exactly what went wrong (bad name match, invalid field code, etc.), and Gemini fixes its own query.

## A small but important SQL detail: `1.0` vs `::FLOAT`

The CAGR formula in this project's raw SQL (`POWER(x * 1.0 / y, ...)`) works fine in Postgres with no extra casting. But the dbt CAGR macro (Phase 2) broke on `ROUND()` and needed an explicit `::NUMERIC` cast. Why the difference?

- `1.0` in Postgres is treated as a `NUMERIC` literal by default.
- `CAST(x AS FLOAT)` (what the dbt macro used) produces `double precision`, a different, less precise type.
- `ROUND()` only accepts `NUMERIC` with a decimal-places argument — it doesn't have a version for `double precision`.

So `x * 1.0` and `CAST(x AS FLOAT)` look like they do the same thing (turn a whole number into a decimal) but land in two different Postgres types, and only one of them is compatible with `ROUND()` without an extra cast. Small detail, but it's the kind of thing that only becomes obvious by hitting the error once.

## Graceful degradation: what happens without an API key

The QA router checks for `GEMINI_API_KEY` once, when the module loads. If it's missing, `/qa/ask` returns a clean `503 Service Unavailable` with a clear message — but every *other* endpoint (institutions, peers, portfolio, federal) keeps working normally. This is a deliberate design choice: one missing piece of configuration shouldn't take down features that don't depend on it.

---

## Frontend basics: reading this codebase's TypeScript/React (not a generic tutorial)

This section explains just enough to read and make small edits to `frontend/`, using the actual files in this project rather than made-up examples. The goal isn't fluency — it's being able to open a file, understand roughly what it does, and make a safe small change (a color, a label, a number) without needing to ask for help every time.

### The four building blocks you'll see in every file

**1. A "component" is just a function that returns HTML-looking code (JSX).**

```tsx
// frontend/components/KpiCard.tsx
export default function KpiCard({ label, value, sublabel }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
```

That's it — a JavaScript function named `KpiCard` that takes some inputs (`label`, `value`) and returns what looks like HTML. This "HTML inside JavaScript" syntax is called **JSX**. `{label}` and `{value}` are how you drop a JavaScript variable into the middle of the HTML — same idea as an f-string in Python (`f"{label}"`), just with curly braces instead.

**2. Props are just function arguments, with a type contract.**

`{ label, value, sublabel }: Props` at the top of the function is Python's equivalent of keyword arguments with type hints. `Props` is defined right above it:

```tsx
interface Props {
  label: string;
  value: string;
  sublabel?: string;   // the ? means optional, like Python's Optional[str] = None
}
```

If you use `<KpiCard label="Total R&D" value="$124M" />` somewhere and forget `value`, TypeScript refuses to build — same spirit as Python type hints, except TypeScript actually *enforces* them before the code ever runs.

**3. `className="..."` is CSS, written as short utility words (Tailwind).**

Instead of a separate `.css` file with rules like `.card { padding: 16px; border-radius: 12px; }`, this project uses **Tailwind**: every visual property is a short class name you stack in `className`. Cheat sheet for the ones you'll see constantly:

| Class | Means |
|---|---|
| `p-4` | padding: 1rem |
| `rounded-xl` | border-radius: large |
| `text-2xl` | font-size: large |
| `font-semibold` | bold-ish |
| `text-slate-500` | gray text |
| `bg-white` | white background |
| `border border-slate-200` | thin light gray border |
| `flex gap-4` | flexbox layout, 1rem gap between children |
| `sm:grid-cols-4` | "at small screens and up, use a 4-column grid" |

If you want to change a color or size, you're almost always just swapping one of these words — you rarely need to write actual CSS. E.g. changing `bg-slate-50` → `bg-blue-50` in `KpiCard.tsx` changes every KPI card's background.

**4. `useState` and `useEffect` — how data gets from the API onto the screen.**

Every tab component (`SnapshotTab.tsx`, `PortfolioTab.tsx`, etc.) follows the exact same shape:

```tsx
const [detail, setDetail] = useState<InstitutionDetail | null>(null);  // 1. a box to hold data, starts empty

useEffect(() => {                                                       // 2. "when instId/startYear/endYear change, do this:"
  getInstitution(instId, endYear).then(setDetail);                      //    fetch from the API, then fill the box
}, [instId, startYear, endYear]);

if (!detail) return <p>Loading…</p>;                                    // 3. show a loading state until the box is full
return <p>{detail.total_rd}</p>;                                        // 4. once full, render using the data
```

Think of `useState` as a single mutable variable that, when changed via its setter (`setDetail`), tells React "re-draw the screen with the new value." `useEffect` is "run this code whenever these specific values change" — the array at the end (`[instId, startYear, endYear]`) is the trigger list. This exact pattern (empty box → fetch on mount → loading check → render) is 90% of what every component in `frontend/components/` does. Once you recognize it, every tab file reads the same way.

### Where to make common small edits

- **Change a label or piece of text** → find the literal string in the relevant `components/*.tsx` file (e.g. `"National Rank"`), edit it directly. No build step needed if `npm run dev` is already running — the browser updates itself.
- **Change a color/spacing** → swap the Tailwind class using the cheat sheet above.
- **Change what data an API call sends/returns** → `frontend/lib/api.ts` (the function that calls the endpoint) and `frontend/lib/types.ts` (the shape TypeScript expects back) always need to match the actual FastAPI response. If you change something in a `api/routers/*.py` file, its matching entry in these two files needs the same shape change, or the frontend build will fail with a type error (which is TypeScript's way of catching the mismatch immediately instead of breaking silently in the browser).
- **Add a new chart** → copy the closest existing chart block in the relevant tab file (they're all wrapped in `<ResponsiveContainer>` from Recharts) and change the `dataKey` props to point at different fields.

### Why the build catches mistakes Streamlit wouldn't

In v1's Streamlit/Python, a typo like `row['toatl_rd']` only breaks when that exact line of code runs — you find out by clicking around. In this TypeScript setup, `npm run build` checks every file's data shapes *before* anything runs, so a similar mistake (`detail.toatl_rd`) is caught immediately with a clear error pointing at the exact line. This is slower to write (you can't just wing it) but catches a whole class of bugs before they ever reach the browser.

### The Docker "live-mount" trap — code changes that silently don't apply

`docker-compose.yml` mounts `./api` into the `api` container as a volume, so editing a `.py` file on your machine really does change the file the container sees — no rebuild needed. But the container's `CMD` runs plain `uvicorn main:app` with **no `--reload` flag**. Live-mounting means the *file* updates instantly; it says nothing about whether the *running process* re-reads it. Uvicorn only loads Python code once, at startup, into memory — it doesn't watch the filesystem unless told to.

The symptom is confusing because it looks like the code was never written correctly: you add a new endpoint, curl it, and get a plain `404 Not Found` — no traceback, no error, just "this route doesn't exist," even though the file on disk clearly has it. The fix is `docker compose restart api` (a few seconds, keeps Postgres and its data untouched) — not a rebuild, since the image itself didn't change, just the code it mounts.

The general lesson: "the file changed" and "the running program knows the file changed" are two different facts. Compiled/interpreted languages that load everything at process start (this FastAPI setup, but also e.g. a long-running Node server without `nodemon`) need either a file-watcher (`--reload`, `nodemon`, etc.) or a manual restart — there's no free "hot swap" just from a Docker volume mount.
