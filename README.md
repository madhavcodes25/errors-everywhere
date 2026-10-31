<div align="center">

# 🛰️ Errors Everywhere

### A flight recorder for builds

**Why did it fail? What changed? Which commit broke it? Is it safe to ship?**  
Answered instantly, from history already stored in MongoDB — with evidence and an honest confidence label.

[![Hackathon](https://img.shields.io/badge/Hackathon-Track%203%3A%20Developer%20Tools%20for%20Production-6f42c1?style=for-the-badge)](#-built-for-track-3)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](#-how-mongodb-is-used)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](#quick-start)
[![React](https://img.shields.io/badge/React-Vite-61DAFB?style=for-the-badge&logo=react&logoColor=black)](#-the-dashboard)
[![Express](https://img.shields.io/badge/API-Express-000000?style=for-the-badge&logo=express&logoColor=white)](#the-api)

[**🚀 Live Dashboard**](https://errors-everywhere-dashboard.onrender.com) &nbsp;•&nbsp; [**📡 Live API**](https://errors-everywhere-api.onrender.com/health) &nbsp;•&nbsp; [**⚡ Quick Start**](#quick-start) &nbsp;•&nbsp; [**🎬 5-Minute Demo**](#-demo-walkthrough)

</div>

---

## 📑 Table of contents

- [Overview](#overview)
- [Why this exists](#-why-this-exists)
- [Highlights](#-highlights)
- [Built for Track 3](#-built-for-track-3)
- [Quick start](#quick-start)
- [Demo walkthrough](#-demo-walkthrough)
- [Recording a real run (the CLI)](#recording-a-real-run-the-cli)
- [The API](#the-api)
- [Architecture](#architecture)
- [How the analysis works](#-how-the-analysis-works)
- [The data contract](#the-data-contract)
- [How MongoDB is used](#-how-mongodb-is-used)
- [The dashboard](#-the-dashboard)
- [Configuration](#configuration)
- [Run with Docker](#-run-with-docker)
- [Repo layout](#repo-layout)
- [Tests](#tests)
- [Limitations (honest)](#limitations-honest)
- [Troubleshooting](#-troubleshooting)
- [Contributors](#-contributors)

---

## Overview

Every CI run dies with the same four questions. Errors Everywhere answers them
instantly, from history already stored in MongoDB — with evidence and an
honest confidence label.

| Question | Answer |
| --- | --- |
| **Why did this build/test fail?** | Per-test verdicts (new regression / flaky / environment problem / long-standing break) from 30 runs of history. |
| **What changed since it last worked?** | Side-by-side diff vs. the last good run: commits, files, dependency bumps (majors flagged), env keys. |
| **Which commit most likely broke it?** | Culprit Ranking: a LIFT score over history plus a path-match fallback, every percentage backed by past run IDs. |
| **Is it safe to release today?** | Points-based release score with reasons and a `blocked` flag. |

Rules and MongoDB do the detective work. The optional LLM only rephrases
verified evidence — every number it writes is checked against the facts, so
**honest beats fluent**.

> 🚀 **Live Dashboard:** [https://errors-everywhere-dashboard.onrender.com](https://errors-everywhere-dashboard.onrender.com)  
> 📡 **Live API:** [https://errors-everywhere-api.onrender.com/health](https://errors-everywhere-api.onrender.com/health)

---

## 💡 Why this exists

When a pipeline goes red, the usual routine is: open the logs, scroll, guess,
re-run, `git bisect`, repeat. Every re-run costs minutes and teaches you
nothing the *last* hundred runs hadn't already shown.

Errors Everywhere flips that around. Each run is recorded **once**, in a
stable, normalized shape. Every later question is answered by **querying that
history**, not by re-running anything.

> `git bisect` rebuilds and retests over and over — we rank suspects instantly
> from history we already stored. **The tool gets sharper with every build,
> with zero re-runs.**

---

## ✨ Highlights

| | Feature | What it gives you |
| --- | --- | --- |
| 🎯 | **Culprit Ranking** *(our USP)* | Suspect commits ranked by a LIFT score over past runs, with a path-match fallback for short histories. Every percentage cites the past run IDs behind it. |
| 🧪 | **Per-test verdicts** | `new_regression`, `flaky`, `environment_problem`, `long_standing_break`, or an honest `unknown`. |
| 🔀 | **What-changed diff** | Commits, files, dependency bumps (majors flagged) and env key names versus the last good run. |
| 🚦 | **Release check** | Explainable points-based score (`LOW` / `MEDIUM` / `HIGH`) with a `blocked` flag; every reason shows its points. |
| ♻️ | **Idempotent ingestion** | `eventId = sha1(project:commit:ciRunId:attempt)` — send the same event twice, it is stored once. |
| 🔐 | **Secrets never stored** | Env var **names** only, never values; error messages are redacted before signing and storage. |
| 📡 | **Live dashboard** | MongoDB change streams → Server-Sent Events: new runs slide into the timeline without a refresh. |
| 🧾 | **Nothing silently dropped** | Refused events land in `rejected_events` with the exact reason, visible on a dedicated page. |
| 🤖 | **Optional, verified LLM summary** | Plain-English explanation; any unverifiable number, file or SHA discards the AI text and falls back to a template. |
| 🪶 | **Zero-dependency collector** | A single CLI that runs Jest, reads git / deps / env names, and POSTs one event. |

---

## 🏁 Built for Track 3

**Track 3: Developer Tools for Production** — *build a tool that helps another
developer understand, debug, or safely change a software or AI project.*

Our precise questions: **why a run failed**, **what changed**, **which commit
broke it**, and **whether a release is safe**.

| Brief requirement | How Errors Everywhere meets it |
| --- | --- |
| Run against your own project or a generated sample | `sample-project/` (`shop-api`) — a small Jest-tested API with a local git repo and six break-on-purpose scenarios. |
| Store runs and events with stable IDs, timestamps, and links to the project/version | `events` + `runs` collections; `eventId` is a deterministic SHA-1; every run carries `projectId`, `commitSha`, `startedAt`. |
| Indexes for the most frequent questions | One index per question (latest runs, filtered lists, flaky history, file correlation, recurring failures). See [How MongoDB is used](#-how-mongodb-is-used). |
| Aggregation pipelines to compare runs / derive findings | Per-test history, flaky check, file fail-rates, and the culprit LIFT score (one `$facet`). |
| Schema validation for required fields, flexible payloads | `$jsonSchema` on `events` and `runs`; `payload` stays free-form. |
| Change streams for live views | `GET /stream` (SSE) drives the live dashboard. |
| Repeated ingestion is safe | `$setOnInsert` + upsert + unique `eventId` index. |
| Demo: second scenario with a meaningful change | `npm run demo:culprit` — three commits, one failing run, one clear culprit. |
| Demo: a practical failure case | Duplicate event, incomplete input, failed job (collector crash), invalid configuration — one command each. |
| LLM optional | Off by default; the app works fully without it. |

---

## Quick start

> **Prerequisites:** Node.js ≥ 20, npm, Git, and a MongoDB Atlas cluster (free M0 tier). Set `MONGODB_URI` in `server/.env` before starting.

```bash
# 1. Clone & enter
git clone <this-repo-url> && cd errors-everywhere

# 2. Install the API server
cd server && npm install

# 3. Configure — paste your Atlas URI into MONGODB_URI
cp .env.example .env

# 4. Initialize the database (idempotent — safe to rerun)
npm run db:setup

# 5. Start the API  →  http://localhost:4000
npm start
```

In a second terminal:

```bash
# 6. Install and start the dashboard  →  http://localhost:5173
cd dashboard && npm install && npm run dev
```

In a third terminal (from the repo root):

```bash
# 7. Build the demo git repo inside sample-project/ (one-time, idempotent)
npm run setup:sample

# 8. Replay 30 days of seeded history into the running server
npm run demo:seed
```

Open the dashboard at `http://localhost:5173`. Click **Load sample data** on the Welcome screen to see the timeline, verdicts, culprit ranking, and release check instantly, or close the panel to connect to the live seeded data.

> 💡 **No Atlas yet?** Leave `MONGODB_URI` empty and the server starts an
> in-memory replica set for local development (change streams still work, but
> data is lost on restart).

---

## 🎬 Demo walkthrough

A 5-minute script that exercises every feature. Everything runs from the repo
root against the **running** server, so you can watch each result appear in the
dashboard.

| Time | Command | What to show |
| --- | --- | --- |
| 0:00 | *(timeline)* | 40 seeded runs over 30 days — the tool's memory. |
| 0:30 | `npm run demo:healthy` | A green run **slides into the timeline without a refresh** (SSE + change streams). Show the raw document: `db.runs.find().sort({startedAt:-1}).limit(1)`. |
| 1:00 | `npm run demo:culprit` | Three commits land together, one run covers all of them. The `payment.js` commit tops the Culprit Ranking; the README commit sits at 0%. Then open *Why it failed*, *What changed* and *Release check*. |
| 2:15 | `npm run demo:duplicate` | Same event twice → stored **once**. Toast: *"Duplicate ignored — nothing changed"*. |
| | `npm run demo:bad-event` | No `projectId` → `400` + a row on the **Rejected events** page. Never a silent drop. |
| | `npm run demo:collector-crash` | Jest cannot start → grey `errored` run carrying the `collectorError`. |
| | `npm run demo:invalid-config` | `STRIPE_KEY` missing → `environment_problem`, release score **+20**. The tool blames the environment before it blames a commit. |
| 3:45 | `mongosh` | `db.runs.getIndexes()` and the file fail-rate aggregation (see [below](#-how-mongodb-is-used)). |
| 4:30 | *Explain in plain English* | Badge shows **Template** (LLM off) or **AI-written, verified against evidence** (LLM on). |

Reset to a clean, seeded state for the next rehearsal: `npm run demo:reset`
(with Atlas it also wipes and reseeds automatically; with the in-memory
fallback it prints the two-step server restart).

<details>
<summary><b>🧨 The six break-on-purpose scenarios</b> (<code>scripts/scenarios/</code>)</summary>

<br>

Each scenario edits `sample-project/`, commits as a named author, runs Jest and
checks that the failure is exactly the expected one.

| Scenario | File | What it breaks | What Errors Everywhere should say |
| --- | --- | --- | --- |
| **A — Healthy** | `A_healthy.js` | Nothing; all 14 tests pass. | Green baseline run. |
| **B — Logic bug** | `B_logic_bug.js` | Drops the payment processing fee → `payment charges card` fails. | Recurring failure; `new_regression`. |
| **C — Dependency** | `C_dependency.js` | Bumps `express` to a new major and loosens the tier boundaries (`>=` → `>`). | Dependency diff with the major flagged; bump commit ranked as culprit. |
| **D — Flaky** | `D_flaky.js` | Adds a `refund works` test that fails ~30% of the time. | `flaky` — passes *and* fails on the **same commit**. |
| **E — Bad config** | `E_bad_config.js` | Removes `STRIPE_KEY` from the environment. No commit. | `environment_problem`, not a code regression. |
| **F — Commit bundle** | `F_commit_bundle.js` | README edit + cart comment + payment fee removal, tested once. | Blames the `payment.js` commit, not the bundle. |

```bash
node scripts/scenarios/B_logic_bug.js              # apply the break and keep it
node scripts/scenarios/B_logic_bug.js --restore    # apply, then restore automatically
node scripts/scenarios/reset.js                    # restore the sample project
```

</details>

---

## Recording a real run (the CLI)

The collector is a zero-dependency CLI. Install it globally from `collector/`:

```bash
cd collector && npm link
# now `errors-everywhere` is on your PATH
```

Run it from inside any project (or pass `--cwd`):

```bash
errors-everywhere run --project shop-api \
  --server http://localhost:4000 \
  --cwd /path/to/my-project
```

What it does:

1. Runs `jest --json` (test failures are normal — they become a `failed` run;
   only "no JSON at all" is a collector crash → `errored`)
2. Reads git (commit, branch, author, commits/files since the last run)
3. Reads declared dependencies and environment variable **names** (never values)
4. Computes `eventId = sha1(projectId:commitSha:ciRunId:attempt)` and POSTs to
   `POST /events`
5. Saves the event to `.errors-everywhere/last-event.json` so
   `errors-everywhere resend` can repeat it verbatim

Idempotency: sending the same `eventId` twice stores it once
(`duplicate_ignored`).

| Command | Purpose |
| --- | --- |
| `errors-everywhere run --project <id> [--server <url>] [--cwd <dir>]` | Run Jest, collect context, send a `run.completed` event. |
| `errors-everywhere resend [--server <url>] [--cwd <dir>]` | Re-send the exact last event — demonstrates duplicate protection. |
| `errors-everywhere --help` | Show usage. |

No `npm link`? Run it directly: `node collector/bin/errors-everywhere.js run --project shop-api`.

---

## The API

| Question | Endpoint | Example response |
| --- | --- | --- |
| Why did it fail? | `GET /runs/:id/diagnosis` | `{ verdict: "new_regression", confidence: "high", evidence: [...] }` |
| What changed? | `GET /runs/:id/changes?against=<runId>` | `{ commits: [...], changedFiles: [...], dependencies: {added,removed,changed}, ... }` |
| Which commit? | `GET /runs/:id/culprits` | `{ candidates: [{ rank, sha, message, matchPercent: 74, reasons: [...] }] }` |
| Safe to release? | `GET /projects/:id/release-check?runId=<runId>` | `{ score: 90, level: "HIGH", blocked: true, reasons: [...] }` |

Other endpoints:

- `POST /events` — idempotent ingestion (the collector's only write)
- `GET /projects/:id/runs` — a project's run history
- `GET /stream` — SSE feed of new/changed runs (drives the live dashboard)
- `POST /runs/:id/summary` — optional LLM plain-English summary (falls back to a template)
- `GET /health` — server health
- `GET /rejected-events` — events the server refused, with reasons (never silently dropped)

<details>
<summary><b>Try it with <code>curl</code></b></summary>

<br>

```bash
BASE=http://localhost:4000

# health
curl $BASE/health

# the project's most recent runs
curl "$BASE/projects/shop-api/runs"

# pick a run id from the list above, then ask the four questions
curl "$BASE/runs/<runId>/diagnosis"
curl "$BASE/runs/<runId>/changes"
curl "$BASE/runs/<runId>/culprits"
curl "$BASE/projects/shop-api/release-check?runId=<runId>"

# what did the server refuse, and why?
curl $BASE/rejected-events

# watch live events (Ctrl-C to stop)
curl -N $BASE/stream
```

</details>

---

## Architecture

```mermaid
flowchart LR
    subgraph SRC["Your project"]
        P["Code + tests<br/>(sample-project / shop-api)"]
    end
    C["Collector CLI<br/>jest --json · git · deps · env names"]
    subgraph API["Server (Express)"]
        I["POST /events<br/>validate · redact · idempotent upsert"]
        A["Analysis engine<br/>diagnosis · changes · culprits · release check · summary"]
        S["GET /stream<br/>SSE"]
    end
    DB[("MongoDB<br/>events · runs<br/>rejected_events · projects")]
    D["Dashboard<br/>React + Vite"]

    P --> C -->|"eventId = sha1(project:commit:ciRunId:attempt)"| I
    I --> DB
    DB --> A
    DB -. "change streams" .-> S
    A --> D
    S -. "live updates" .-> D
```

The same flow, in plain text:

```
 sample-project (shop-api)          collector (CLI)                MongoDB
 ┌──────────────────────┐   ┌──────────────────────────┐   ┌──────────────────┐
 │ src/*.js + Jest tests│──▶│ runs jest --json         │──▶│ events   (raw    │
 │ git repo             │   │ reads git / deps / env   │   │  audit trail)    │
 └──────────────────────┘   │ eventId = sha1(project:  │   │ runs (normalized │
         demo scenarios     │   commit:ciRunId:attempt)│   │  for analysis)   │
         (break on purpose) │ POST /events (idempotent)│   │ rejected_events  │
                            └──────────────────────────┘   │ projects         │
                                                           └──────┬───────────┘
                                                                 ▼
                      dashboard (React+Vite) ◀── SSE /stream ◀── server (Express)
                      timeline, diagnosis,   (change streams,    analysis engine:
                      culprits, changes,      heartbeat, restart) diagnosis /
                      release check           GET /rejected-events  changes /
                                               /health               culprits /
                                                                      summary
```

---

## 🧠 How the analysis works

Everything below is deterministic: same history in, same answer out. The LLM
never decides anything.

### Confidence labels — never fake certainty

| Label | Prior runs of history |
| --- | --- |
| `low` | fewer than 5 |
| `medium` | 5 to 15 |
| `high` | more than 15 |

### 1 · Why did it fail? — per-test verdicts

Each failed test is classified by the **first** rule that matches:

| Order | Verdict | Rule |
| --- | --- | --- |
| 1 | `flaky` | The same test both passed **and** failed on the **same commit, in the same environment**. |
| 2 | `environment_problem` | Required env vars are missing now — **or** dependencies changed *and* 3+ tests failed with the same error signature. |
| 3 | `new_regression` | It passed in the immediately previous run and fails now. |
| 4 | `long_standing_break` | It has failed in the last 3+ consecutive runs. |
| 5 | `unknown` | The honest fallback — no clear pattern, inspect manually. |

A **known fix** box also reports how many times the same error signature was
seen before, and the first later passing run.

### 2 · What changed? — diff vs. the last good run

Commits, changed files, dependencies (`added` / `removed` / `changed`, with
**major** bumps flagged) and environment variable names — side by side with the
last run that passed.

### 3 · Which commit broke it? — Culprit Ranking

1. **Candidates** — every commit recorded after the last good run, up to and including the failing run (covers multi-run failure streaks).
2. **LIFT per (test, file)** — one `$facet` aggregation over the last 30 earlier runs:

   ```
   failGivenChanged(T,F) = runs where F changed AND T failed / runs where F changed
   failOverall(T)        = runs where T failed / total runs
   lift(T,F)             = (failGivenChanged + a) / (failOverall + a)      a = 0.05
   ```

   Files that changed in fewer than 2 past runs are treated as neutral (`lift = 1`).
3. **Path-match bonus** — a file matching the failing test's module (`src/payment.js` ↔ `tests/payment.test.js`) adds **+1.0**. This keeps short histories useful.
4. **Commit score** — the sum over its files and all failed tests of `max(0, lift − 1) + pathBonus`. Files that never correlate (`README.md`) naturally score 0.
5. **Normalize** — scores are scaled to sum to 100%. If everything scores 0, candidates get equal shares, confidence drops to `low`, and a message says so.

Every reason is a fact from history, e.g. *"src/payment.js changes preceded
'payment charges card' failures in 6 of 12 past runs"*, with the run IDs
attached as evidence.

### 4 · Is it safe to release? — explainable points

Start at 0, add points per rule. Every reason names its real evidence (test
names, files, run IDs). Tune the numbers in the `RULES` object in
`server/src/analysis/releaseCheck.js`.

| Rule | Points |
| --- | --- |
| Latest run did not pass | **+50** and `blocked: true` |
| Each currently failing test | +10 (max +30) |
| Unfixed high-suspicion commit (top culprit > 60%) | +10 |
| Each changed file with historical fail-rate > 40% | +15 (max +30) |
| Each major dependency upgrade vs. last good run | +15 |
| Missing or changed required env var | +20 |
| More than 10 files changed in one run | +10 |
| 2+ failed runs among the last 5 | +10 |
| A flaky test exercises files this run touched | +5 |

**Levels:** `HIGH` ≥ 60 · `MEDIUM` ≥ 30 · otherwise `LOW`.

### 5 · Optional plain-English summary

1. Rules collect the facts into one small evidence JSON (env var **names** only; no raw logs, no secrets).
2. `evidenceHash = sha1(evidence)` — an identical hash returns the cached summary with no new call.
3. If `LLM_ENABLED=true` and a key is present, the model rephrases the evidence (10 s timeout, max ~80 words).
4. The output is **verified claim by claim** — every number, file name, commit SHA and quoted test name must exist in the evidence. Anything unverifiable → the whole LLM text is discarded and the template is used.

---

## The data contract

- **events** (raw audit trail): `{ eventId, projectId, type, timestamp, receivedAt, payload }` — `eventId = sha1(projectId:commitSha:ciRunId:attempt)`; re-sending is a no-op (`$setOnInsert` upsert + unique index).
- **runs** (normalized, what analysis reads): `{ _id: "run_" + eventId.slice(0,12), eventId, projectId, commitSha, branch, author, startedAt, finishedAt, durationMs, status: passed|failed|errored, commits[], changedFiles[], dependencies[] (array — dots in @scope/pkg would break as field names), envKeys[] (NAMES only, never values), missingEnvKeys[], tests[] ({name, file, status, durationMs, error{message, signature}}), collectorError?, summary? }`
- **rejected_events**: what the server refused, with the exact reason (re-redacted on display).
- **projects**: `{ _id, name, requiredEnvKeys[] }`.

Secrets: error messages are redacted before signing/storage — connection strings,
tokens, `key=value` leaks, long hex blobs → `[REDACTED]`. Values are never stored.

---

## 🍃 How MongoDB is used

- **Schema validation** — `$jsonSchema` on `events` and `runs` (created by the idempotent `npm run db:setup`, applied on every server boot): even a buggy writer cannot store a contract-breaking document (verified: error code 121).
- **Indexes** — one per question: `{eventId:1}` unique (idempotency); `{projectId, startedAt:-1}` (latest runs); `{projectId, status, startedAt:-1}` (filtered lists + last-good-run); `{projectId, "tests.name":1}` (flaky history); `{projectId, changedFiles:1}` (file correlation); `{projectId, "tests.error.signature":1}` (recurring failures). `explain()` shows the latest-runs query as `LIMIT → FETCH → IXSCAN`.
- **Aggregation** — the analysis core: per-test history pipelines, the flaky check (`$group` by test + commitSha), file fail-rates (`$unwind changedFiles → $group`), and the culprit LIFT score (one `$facet` for totals/test/file/co-occurrence stats).
- **Change streams** — `GET /stream` pushes new/changed runs to the dashboard live (replica sets only; the server falls back to polling and tells you to use Atlas otherwise).
- **Idempotent ingestion** — `$setOnInsert` + upsert + unique index: the same event sent twice is stored once; the run upsert also repairs a crash between the two stores.

<details>
<summary><b>Peek inside with <code>mongosh</code></b></summary>

<br>

```js
// the newest normalized run
db.runs.find().sort({ startedAt: -1 }).limit(1)

// the indexes behind every question
db.runs.getIndexes()

// which files fail most often when they change? (feeds Culprit Ranking)
db.runs.aggregate([
  { $match: { projectId: "shop-api" } },
  { $unwind: "$changedFiles" },
  { $group: {
      _id: "$changedFiles",
      runs: { $sum: 1 },
      failures: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } }
  } }
])

// prove the validator rejects a contract-breaking document (error code 121)
db.runs.insertOne({ projectId: "shop-api" })
```

</details>

---

## 🖥️ The dashboard

Typography-led, dark by default, readable on a projector. React 18 + Vite.

| Screen | What it shows |
| --- | --- |
| **Welcome** | Guided first-run steps and a **Load sample data** switch (no server needed). |
| **Timeline** | Live run history with the big release-safety verdict on top. |
| **Run detail** | *Why it failed* (verdict + confidence + evidence), *Culprit Ranking* (percentage bars and the past runs behind each claim), *What changed* (side by side with the last good run), and **Explain in plain English**. |
| **Rejected events** | Everything the server refused, with the reason. |

Dashboard settings (`dashboard/src/config/index.js` or env vars at dev time):

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000` | Server base URL. |
| `VITE_PROJECT_ID` | `shop-api` | Project shown first. |
| `VITE_USE_MOCK` | `false` | Start on built-in sample data (overridden by the **Load sample data** button). |

More in [`dashboard/README.md`](dashboard/README.md).

---

## Configuration

The server reads `server/.env` on startup. Copy `server/.env.example` and fill in:

| Variable | Default | Description |
| --- | --- | --- |
| `MONGODB_URI` | *(required)* | Atlas connection string (`mongodb+srv://...`). |
| `PORT` | `4000` | Port the Express API listens on. |
| `DATABASE_NAME` | `errors-everywhere` | MongoDB database name. |
| `LLM_ENABLED` | `false` | Set `true` to enable plain-English AI summaries. |
| `MODEL_PROVIDER` | `openai` | `openai` or `anthropic` (any `/chat/completions`-compatible endpoint). |
| `MODEL_NAME` | `gpt-4o-mini` | Model to use for summaries. |
| `API_KEY` | *(empty)* | Key for the model provider. Never logged or stored. |
| `MODEL_BASE_URL` | `https://api.openai.com/v1` | Override for Azure proxies, LM Studio, etc. |

> 🔒 `server/.env` and `sample-project/.env` are git-ignored. Never commit real credentials.

---

## 🐳 Run with Docker

`docker-compose.yml` builds the API server and the dashboard (served on port `5173`).

```bash
export MONGODB_URI="mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/errors-everywhere"
docker compose up --build
```

| Service | URL |
| --- | --- |
| API | http://localhost:4000 |
| Dashboard | http://localhost:5173 |

Optional: set `LLM_ENABLED`, `MODEL_PROVIDER`, `MODEL_NAME`, `API_KEY`, `MODEL_BASE_URL`
and `VITE_API_URL` the same way.

---

## Repo layout

```
sample-project/   shop-api + Jest tests + git repo + break-on-purpose scenarios
collector/        CLI: run / resend (zero dependencies)
server/           Express + mongodb driver: ingest, analysis, SSE, summary
dashboard/        React + Vite: timeline, run detail, culprits, release check
scripts/          seeder, demo scenarios, one-command demo scripts
```

<details>
<summary><b>Detailed tree</b></summary>

<br>

```
errors-everywhere/
├── collector/
│   ├── bin/errors-everywhere.js     # CLI entry point (run / resend)
│   └── src/                         # jest runner, git, deps, env, signature, send
├── server/
│   ├── src/
│   │   ├── app.js  index.js         # Express app + bootstrap
│   │   ├── ingest.js normalize.js   # validation, redaction, idempotent writes
│   │   ├── dbSetup.js db.js         # $jsonSchema validators + indexes
│   │   ├── realtime.js routes/stream.js   # change streams → SSE
│   │   ├── analysis/                # diagnose, changes, culprits, releaseCheck,
│   │   │                            # aggregations, evidence, summarize, history
│   │   └── lib/                     # confidence, signature, redact, testMap
│   └── scripts/                     # db-setup, test-api, test-analysis
├── dashboard/                       # React + Vite UI (components, pages, copy, styles)
├── sample-project/                  # shop-api: cart, discount, payment, auth + Jest tests
├── scripts/
│   ├── scenarios/                   # A–F break-on-purpose scenarios
│   ├── demo/                        # one-command demo scripts (npm run demo:*)
│   ├── seed.js seed-via-api.js      # 30-day history seeder
│   ├── setup-sample-repo.js         # builds the demo git repo
│   ├── smoke.js                     # end-to-end contract check
│   └── demo.md                      # the 5-minute demo script
└── docker-compose.yml
```

</details>

### Root scripts

| Script | What it does |
| --- | --- |
| `npm run setup:sample` | Build the demo git repo inside `sample-project/` (idempotent). |
| `npm run demo:seed` | Replay 30 days of history into the running server. |
| `npm run demo:reset` | Clean, seeded state for the next rehearsal. |
| `npm run demo:healthy` | Green run, live update. |
| `npm run demo:culprit` | Scenario F + Culprit Ranking. |
| `npm run demo:duplicate` | Idempotent ingestion. |
| `npm run demo:bad-event` | `400` + Rejected events page. |
| `npm run demo:collector-crash` | Grey `errored` run with `collectorError`. |
| `npm run demo:invalid-config` | `environment_problem` + risk +20. |

---

## Tests

- `server: npm test` — unit tests (13 passing)
- `server: npm run test:api` — API contract checks against a live server
- `server: npm run test:analysis` — diagnosis / changes / culprits / release-check acceptance checks against seeded data
- `sample-project: npm test` — the demo suite itself

There is also an end-to-end smoke check (ingest → idempotency → rejection →
redaction → diagnosis → changes → culprits → release-check):

```bash
node scripts/smoke.js          # from the repo root, with the server running
```

---

## Limitations (honest)

- **Confidence depends on history**: verdicts are `low` below 5 prior runs, `high` above 15. Fresh projects get honest "unknown" answers, not guesses.
- Culprit ranking ranks only the commits **between the last good run and the failure** — it cannot see changes that were never recorded.
- The flaky verdict needs the same commit to have both outcomes; a first-time flake on a brand-new commit looks like a regression.
- The safety-checked LLM summary is strict: any number/file/sha it writes that is not in the evidence discards the whole LLM text (falls back to the template). Honest beats fluent.
- Single-branch thinking: history comparisons are project-scoped (branch-scoped only in culprit baselines).
- The in-memory fallback is for development only — data dies with the process.

---

## 🩺 Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Server won't start / can't connect | Check `MONGODB_URI` in `server/.env`, and that your IP is allowed in Atlas **Network Access**. |
| Dashboard shows no data | Make sure the server is running on `http://localhost:4000`, run `npm run demo:seed`, or click **Load sample data**. |
| Runs don't appear live | Change streams need a replica set (Atlas always is). Otherwise the server falls back to polling. |
| `npm run demo:*` fails with a connection error | The scripts talk to a **running** server — start it first, or pass `--server <url>`. |
| Demo scenarios complain about git | Run `npm run setup:sample` once to build the sample repo. |
| Sample project left in a broken state | `node scripts/scenarios/reset.js` restores it. |
| Data lost after restart | You are on the in-memory fallback (empty `MONGODB_URI`). Use Atlas for persistence. |

---

## 👥 Contributors

| # | Name |
| --- | --- |
| 1 | **Madhav Daluka** |
| 2 | **Mridul Gupta** |
| 3 | **Sankalp Singh Chauhan** |

---

<div align="center">

Built for **Track 3: Developer Tools for Production** · Powered by **MongoDB**

*Honest beats fluent.*

</div>
