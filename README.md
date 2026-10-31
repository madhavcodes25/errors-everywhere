# Errors Everywhere — a flight recorder for builds

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

---

## Architecture

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

## The data contract

- **events** (raw audit trail): `{ eventId, projectId, type, timestamp, receivedAt, payload }` — `eventId = sha1(projectId:commitSha:ciRunId:attempt)`; re-sending is a no-op (`$setOnInsert` upsert + unique index).
- **runs** (normalized, what analysis reads): `{ _id: "run_" + eventId.slice(0,12), eventId, projectId, commitSha, branch, author, startedAt, finishedAt, durationMs, status: passed|failed|errored, commits[], changedFiles[], dependencies[] (array — dots in @scope/pkg would break as field names), envKeys[] (NAMES only, never values), missingEnvKeys[], tests[] ({name, file, status, durationMs, error{message, signature}}), collectorError?, summary? }`
- **rejected_events**: what the server refused, with the exact reason (re-redacted on display).
- **projects**: `{ _id, name, requiredEnvKeys[] }`.

Secrets: error messages are redacted before signing/storage — connection strings,
tokens, `key=value` leaks, long hex blobs → `[REDACTED]`. Values are never stored.

---

## How MongoDB is used

- **Schema validation** — `$jsonSchema` on `events` and `runs` (created by the idempotent `npm run db:setup`, applied on every server boot): even a buggy writer cannot store a contract-breaking document (verified: error code 121).
- **Indexes** — one per question: `{eventId:1}` unique (idempotency); `{projectId, startedAt:-1}` (latest runs); `{projectId, status, startedAt:-1}` (filtered lists + last-good-run); `{projectId, "tests.name":1}` (flaky history); `{projectId, changedFiles:1}` (file correlation); `{projectId, "tests.error.signature":1}` (recurring failures). `explain()` shows the latest-runs query as `LIMIT → FETCH → IXSCAN`.
- **Aggregation** — the analysis core: per-test history pipelines, the flaky check (`$group` by test + commitSha), file fail-rates (`$unwind changedFiles → $group`), and the culprit LIFT score (one `$facet` for totals/test/file/co-occurrence stats).
- **Change streams** — `GET /stream` pushes new/changed runs to the dashboard live (replica sets only; the server falls back to polling and tells you to use Atlas otherwise).
- **Idempotent ingestion** — `$setOnInsert` + upsert + unique index: the same event sent twice is stored once; the run upsert also repairs a crash between the two stores.

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

---

## Repo layout

```
sample-project/   shop-api + Jest tests + git repo + break-on-purpose scenarios
collector/        CLI: run / resend (zero dependencies)
server/           Express + mongodb driver: ingest, analysis, SSE, summary
dashboard/        React + Vite: timeline, run detail, culprits, release check
scripts/          seeder, demo scenarios, one-command demo scripts
```

---

## Tests

- `server: npm test` — unit tests (13 passing)
- `server: npm run test:api` — API contract checks against a live server
- `server: npm run test:analysis` — diagnosis / changes / culprits / release-check acceptance checks against seeded data
- `sample-project: npm test` — the demo suite itself

---

## Limitations (honest)

- **Confidence depends on history**: verdicts are `low` below 5 prior runs, `high` above 15. Fresh projects get honest "unknown" answers, not guesses.
- Culprit ranking ranks only the commits **between the last good run and the failure** — it cannot see changes that were never recorded.
- The flaky verdict needs the same commit to have both outcomes; a first-time flake on a brand-new commit looks like a regression.
- The safety-checked LLM summary is strict: any number/file/sha it writes that is not in the evidence discards the whole LLM text (falls back to the template). Honest beats fluent.
- Single-branch thinking: history comparisons are project-scoped (branch-scoped only in culprit baselines).
- The in-memory fallback is for development only — data dies with the process.
