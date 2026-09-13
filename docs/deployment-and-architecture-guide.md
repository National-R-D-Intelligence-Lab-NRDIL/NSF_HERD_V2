# How HERDIntel Actually Runs — Architecture, Deployment & Safe-Change Guide

> Companion to `docs/learning.md` (which covers Docker/dbt/FastAPI/frontend basics). This one is about
> what happens *after* the code is written: where it lives, how a change reaches real users, and what
> to be careful about. Written for maintaining this without a formal dev/ops background.

---

## Part 1 — The Big Picture: Five Separate Places, Not One

The instinct is to think of "the app" as one thing. It's actually **five separate systems**, owned by
different companies, that only work together because you've wired them to. None of them know about
the others automatically — every connection between them is a setting you configured by hand.

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────────────┐
│   Your laptop     │      │      GitHub        │      │   GCP VM (nsf-herd-    │
│  (where you edit   │─push→│  (the vault — the │─pull→│    server)              │
│   files with       │      │  one "official"    │      │  Runs the actual app:  │
│   Claude Code)      │      │  copy of history)   │      │  Postgres, API,        │
└─────────────────┘      └──────────────────┘      │  frontend, Caddy        │
                                                        └───────────┬─────────────┘
                                                                    │
                        ┌───────────────────────────────────────────┼───────────────────┐
                        │                                            │                    │
                ┌───────▼────────┐                          ┌────────▼────────┐  ┌────────▼────────┐
                │   Cloudflare     │                          │    Supabase      │  │     Resend       │
                │  Owns herdintel  │                          │  Owns accounts,  │  │  Sends invite/   │
                │  .app's DNS,     │                          │  login, JWTs.    │  │  password-reset  │
                │  hosts the       │                          │  Entirely        │  │  emails on       │
                │  landing page,   │                          │  separate cloud  │  │  Supabase's      │
                │  will route      │                          │  service — not   │  │  behalf, via     │
                │  traffic to the  │                          │  on the VM at    │  │  herdintel.app's  │
                │  VM              │                          │  all             │  │  domain          │
                └─────────────────┘                          └─────────────────┘  └─────────────────┘
```

**The one sentence that matters most:** editing a file on your laptop changes *nothing* for real users
until it's pushed to GitHub, pulled onto the GCP VM, and the containers are rebuilt. There is no
automatic sync between your laptop and the live app. Every deploy is a manual, deliberate act — right
now, several manual acts across several different dashboards.

---

## Part 2 — What's Actually Built (and What Isn't)

| Piece | Status | Where it lives |
|---|---|---|
| Postgres database | ✅ Built | GCP VM, in a Docker container |
| dbt (data transformation) | ✅ Built | GCP VM, runs on-demand (not a background service) |
| FastAPI backend | ✅ Built | GCP VM, in a Docker container |
| Next.js frontend | ✅ Built | GCP VM, in a Docker container |
| Supabase Auth (login/invite/reset) | ✅ Built | Supabase's own cloud, not the VM |
| Caddy reverse proxy | ✅ Just added | GCP VM, in a Docker container |
| Landing page (`herdintel.app`) | ✅ Built | Cloudflare's own edge network, not the VM |
| Email sending (Resend) | ✅ Built | Resend's cloud, triggered by Supabase |
| Dagster (orchestration) | ⬜ Not built | — |
| DuckDB (fast analytics) | ⬜ Not built | — |
| GitHub Actions CI (automated testing on push) | ⬜ Not built | — |
| Scenario modeling / forward projections | ⬜ Not built | — |
| **Multi-tenancy** (institution-scoped accounts/data) | ⬜ **Not built** | — |
| Usage tracking (who did what, when) | ⬜ Not built | — |

**On multi-tenancy specifically, since you asked directly**: there is no institution-scoping anywhere
in the system today. No `tenant_id` column, no row-level security, no per-institution data isolation.
What stands in for it right now is entirely manual: *you* are the only person who can create an account
(self-signup is disabled), so "University X gets 2 seats" is true only because you personally choose to
create exactly 2 accounts for them and no more. If you ever create a third, there's nothing in the
system to stop you. A real design for this exists on paper in `docs/implementation-plan.md`
(tenants table, user_profiles table, usage_events table) but none of it has been built.

---

## Part 3 — Dev Mode vs. Production Mode (Same Files, Different Behavior)

There is only **one** `docker-compose.yml`, but it behaves two different ways depending on one flag:

| | Local (your laptop) | Production (GCP VM) |
|---|---|---|
| Command | `docker compose up` | `docker compose -f docker-compose.yml up -d --build` |
| Extra file loaded? | `docker-compose.override.yml` (auto-loaded) | **None** — the `-f` flag explicitly excludes it |
| Frontend runs as | `npm run dev` (hot reload, code changes appear instantly) | `next build` + `next start` (optimized, but needs a rebuild to see any change) |
| Why | You want instant feedback while editing | You want a fast, stable, production-grade bundle for real users |

**The trap**: if you ever SSH into the VM and run a bare `docker compose up` (no `-f` flag), it silently
picks up `docker-compose.override.yml` and switches the live production frontend back into dev mode —
this exact bug happened once already (see `docs/decisions.md`, Phase 8). The fix is always using the
explicit `-f docker-compose.yml`, which is exactly what `deploy.sh` does for you — use that script, don't
type the docker command by hand.

---

## Part 4 — Git's Real Role: A One-Way Delivery Truck, Not a Sync Tool

Git is not "the thing that makes prod match your laptop automatically." It's closer to a **delivery
truck that only moves when you call it**:

1. You edit a file on your laptop.
2. `git commit` — packages the change with a note describing it.
3. `git push` — sends it to GitHub (the shared, canonical copy).
4. **Nothing happens on the GCP VM yet.** The VM has its own separate copy of the repo, and it has no
   idea your push just happened.
5. Someone has to SSH into the VM and run `git pull` — this is the truck actually arriving and unloading.
6. Even after the pull, the running containers are still the *old* code until you rebuild them
   (`deploy.sh` does the pull + rebuild together).

**Current friction, worth knowing**: the VM has no saved GitHub login for pulling — every `git pull`
on the VM requires typing a username/token by hand, in an interactive session (the GCP Console's
browser SSH button). This is why I couldn't run the pull step for you automatically earlier — there's
no stored credential for a script to use. If this becomes annoying, the fix is a one-time setup of a
GitHub **deploy key** or a saved token via `git config credential.helper store` on the VM — worth doing
once, whenever you want.

---

## Part 5 — The GCP VM, Concretely

- **Name/zone**: `nsf-herd-server`, `us-south1-b`
- **Public IP**: `34.174.156.116`
- **Repo location on the VM**: `/home/kalyan8358/NSF_HERD_V2` — but note, `gcloud compute ssh` logs you
  in as a *different* local user, landing in a different home directory. Reaching the repo needs
  `sudo` or `sudo -u kalyan8358`.
- **What's running**: 4-5 Docker containers (`herd_postgres`, `herd_api`, `herd_frontend`,
  `herd_caddy`, and `dbt` which only runs on-demand, not continuously)
- **Firewall** (`allow-app-ports` rule): only `3000`, `8000`, and now `443` are reachable from the
  internet. Nothing else gets in from outside — this is why adding the reverse proxy required
  explicitly opening `443`, and why Postgres's `5432` isn't actually exposed to the internet despite
  Docker binding it to `0.0.0.0` (the firewall blocks it before it ever reaches the container).
- **The `.env` file on the VM is separate from your laptop's `.env`.** They are two different files
  that happen to have similar contents. Changing a value in one does **not** change the other. When
  we pointed the frontend at `https://api.herdintel.app` today, that edit happened only on the VM's
  `.env` — your laptop's `.env` (for local dev) is untouched and still points at `localhost`, which is
  correct for local dev.

---

## Part 6 — The New Domain/Email Layer (This Week's Additions)

Three more external services, none of which live on the GCP VM:

- **Cloudflare** — you bought `herdintel.app` here. It also hosts the landing page (as a "Worker with
  static assets" — Cloudflare's current name for what used to be the separate "Pages" product), and it
  will soon sit in front of the GCP VM as a reverse-proxy/CDN layer, handling HTTPS automatically so the
  VM itself never needs a real SSL certificate.
- **Resend** — sends the actual emails (invite, password reset) on Supabase's behalf, using
  `herdintel.app` as the sending domain. Needed because Supabase's own built-in mailer is capped at
  2 emails/hour on any plan — fine for testing, not for real use.
- **Supabase** — handles every account, login, and password reset. It has its **own separate settings
  dashboard** (Site URL, allowed redirect URLs) that has to be manually kept in sync with wherever the
  app is actually reachable. This bit us today — the "Site URL" had drifted back to `127.0.0.1` and
  broke password reset links until we corrected it. This setting lives in Supabase's dashboard, not in
  any file in this repo, so there's no `git diff` or history for it — you have to remember to check it
  whenever the app's address changes.

---

## Part 7 — The "Things That Bite People" Checklist

Read this before making *any* change that's meant to reach real users:

1. **`NEXT_PUBLIC_*` environment variables need a full rebuild, not a restart.** Next.js bakes these
   values into the frontend's code at *build* time. Changing the value in `.env` and just restarting
   the container does nothing — the old value is already permanently baked into the files that get
   served. You must rebuild (`--build`).
2. **Always deploy with `deploy.sh` (or the explicit `-f docker-compose.yml` flag), never a bare
   `docker compose up` on the VM.** A bare command silently re-enables dev mode via the override file.
3. **Rebuilding restarts containers, which briefly interrupts anyone using the app at that moment.**
   Treat any `--build` deploy on the VM as a short outage window (usually under a minute) — avoid it
   during active demos or known usage windows.
4. **The VM's `.env` and your laptop's `.env` are two different files.** A change to one never
   automatically applies to the other. If a setting needs to be different in production (like the API
   URL), you have to manually edit it on the VM.
5. **There are no automated database backups.** Every backup that exists so far has been a manual,
   one-off `pg_dump` you ran yourself. Before any operation that touches the database structurally
   (not just normal app usage — think schema changes, bulk deletes, migrations), take a manual backup
   first. There's no "undo" otherwise.
6. **DNS, firewall, and Supabase dashboard settings are not tracked in git.** There's no commit
   history, no diff, no easy rollback for any of these — they're changed by hand in a web UI. The only
   record of *why* something is configured a certain way is whatever gets written down in
   `docs/decisions.md`. Get in the habit of jotting down dashboard changes there, the same way code
   changes get a commit message.
7. **Git pull on the VM needs a human typing credentials.** Nothing about deployment is currently
   "run one command and walk away" — someone has to be present for the pull step specifically.

---

## Part 8 — A Safe Workflow for Making Any Change

Follow this order every time, without skipping steps:

1. **Make the change on your laptop.** Use Claude Code as you have been.
2. **Test it locally first**, using dev mode: `docker compose up` (this auto-loads the override file,
   giving you hot-reload so you can actually see the change working before it goes anywhere near real
   users).
3. **Commit with a clear message** describing *why*, not just *what* — future-you (or Claude, in a
   fresh session) will thank you.
4. **Push to GitHub.**
5. **Pick a low-traffic moment** — check if anyone's actively using the app before triggering a
   production rebuild, since it causes a brief interruption.
6. **SSH into the VM** (via the GCP Console's browser SSH button, since that's the only place with
   working GitHub credentials right now), `cd` to the repo, and run `git pull` (typing credentials when
   prompted).
7. **Run `deploy.sh`** — this does the rebuild for you correctly (explicit `-f`, no override file).
8. **Verify it actually worked** — load the real URL in a browser, don't just trust that the command
   didn't error. Check `docker compose ps` to confirm all containers show as "Up."
9. **If something changed outside the repo** (a DNS record, a Supabase dashboard setting, a Cloudflare
   config) — write a short note in `docs/decisions.md` about what and why, since nothing else will
   remember it for you.

---

## Part 9 — Glossary (Plain-Language)

| Term | Plain meaning |
|---|---|
| **Repo / repository** | The folder of code, tracked by git, with full history of every change |
| **Commit** | A saved snapshot of changes, with a note explaining them |
| **Push / Pull** | Push = send your commits to GitHub. Pull = fetch GitHub's commits onto another machine |
| **Container** | An isolated, pre-packaged mini-environment for running one piece of software (see `docs/learning.md` for the full explanation) |
| **Environment variable** | A named setting (like a password or URL) passed into a program from outside its code, so the same code can behave differently in different places without editing the code itself |
| **DNS** | The internet's phone book — translates a domain name (`herdintel.app`) into the actual server address (IP) to connect to |
| **Reverse proxy** | A traffic director that sits in front of your real app and forwards requests to the right internal service based on the address requested |
| **SSL/TLS / HTTPS** | The encryption layer that makes a connection private; a "certificate" is the credential that proves a server is who it claims to be |
| **SPF / DKIM / DMARC** | Three DNS records that let receiving mail servers verify an email claiming to be from your domain is actually authorized to be — reduces (but doesn't eliminate) spam/phishing filtering |
| **Firewall rule** | A GCP-level setting controlling which network ports can even be reached from the internet, independent of what's running inside the server |
| **Multi-tenancy** | A system design where multiple separate customers/organizations share the same app but their data and access are kept isolated from each other — not built here yet |
| **Staging vs. Production** | Staging = a copy used for testing before it's real; Production = the live thing real users touch. This project doesn't have a separate staging server — local dev mode is the closest equivalent |

---

## What to Read Next

- `docs/learning.md` — how Docker, dbt, FastAPI, and the frontend actually work, file by file
- `docs/decisions.md` — the running log of what was built, why, and what was rejected — check this
  before assuming something wasn't considered
- `docs/implementation-plan.md` — the unbuilt design for auth/multi-tenancy/usage-tracking, if you
  decide to pick that up later
