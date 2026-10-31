# TraceBack — a flight recorder for builds

Track 3: Developer Tools for Production

Every CI run dies with the same four questions. TraceBack answers them
instantly, from history already stored in MongoDB — with evidence and an
honest confidence label.

1. **Why did this build/test fail?** — per-test verdicts (new regression /
   flaky / environment problem / long-standing break) from 30 runs of history.
2. **What changed since it last worked?** — side-by-side diff against the last
   good run: commits, files, dependency bumps (majors flagged), env keys.
3. **Which commit most likely broke it?** — Culprit Ranking: a LIFT score over
   history plus a path-match fallback, every percentage backed by past run IDs.
4. **Is it safe to release today?** — a points-based score with reasons, and a
   blocked flag.

Rules and MongoDB do the detective work. The optional LLM only rephrases
verified evidence — and every number it writes is checked against the facts.

## Architecture

```
 sample-project (shop-api)          collector (CLI)                MongoDB
 ┌──────────────────────┐   ┌──────────────────────────┐   ┌──────────────────┐
 │ src/*.js + Jest tests│──▶│ runs jest --json         │──▶│ events   (raw,   │
 │ git repo + scenarios │   │ reads git / deps / env   │   │ runs     (normal)│
 └──────────────────────┘   │ eventId = sha1(project:  │   │ rejected_events  │
        demo scenarios      │   commit:ciRunId:attempt)│   │ projects         │
        (break on purpose)  │ POST /events (idempotent)│   └──────┬───────────┘
                            └──────────────────────────┘          │
                                                                  ▼
 dashboard (React+Vite) ◀── SSE /stream ◀── server (Express) ── analysis
 timeline, diagnosis,      (change streams,  engine: diagnosis / changes /
 culprits, changes,        heartbeat, restart)        culprits / release / summary
 release check             GET /rejected-events, /health
```

## The four answers, as endpoints

| Question | Endpoint |
| --- | --- |
| Why did it fail? | `GET /runs/:id/diagnosis` |
| What changed? | `GET /runs/:id/changes?against=<runId>` (default: last good run) |
| Which commit? | `GET /runs/:id/culprits` |
| Safe to release? | `GET /projects/:id/release-check?runId=<runId>` |

Plus the API contract: `POST /events` (idempotent), `GET /projects/:id/runs`,
`GET /stream` (SSE), `POST /runs/:id/summary` (optional LLM), `GET /health`,
and `GET /rejected-events` (Part 8 addition — what the server refused, re-redacted).

## Setup (under 10 steps)

1. Node 20+, a MongoDB **Atlas free tier** (a replica set — change streams
   need one). No Atlas? The server falls back to a local in-memory replica
   set for development (data is lost on restart).
2. `git clone <this repo> && cd traceback`
3. `cd server && npm install`
4. `cp .env.example .env` and set `MONGODB_URI` (Atlas connection string).
   Leave it empty for the in-memory fallback.
5. `npm run db:setup` — creates the collections with `$jsonSchema`
   validators + all indexes. Idempotent; safe to run any time.
6. `npm start` — the API on `http://localhost:4000`
7. `cd ../dashboard && npm install && npm run dev` — the UI on
   `http://localhost:5173`
8. `cd .. && npm run demo:seed` — replays 30 days of realistic history into
   the running server (also works against Atlas).
9. Optional, sample project: `cd sample-project && npm install` (Jest + deps
   for the demo scenarios and the collector).
10. Follow `scripts/demo.md` for the 5-minute demo (`npm run demo:…`).

## The data contract (short version)

- **events** (raw audit trail): `{ eventId, projectId, type, timestamp,
  receivedAt, payload }` — `eventId = sha1(projectId:commitSha:ciRunId:attempt)`;
  re-sending an event is a no-op (`$setOnInsert` upsert + unique index).
- **runs** (normalized, what analysis reads): `{ _id: "run_"+eventId.slice(0,12),
  eventId, projectId, commitSha, branch, author, startedAt, finishedAt,
  durationMs, status: passed|failed|errored, commits[], changedFiles[],
  dependencies[] (array — dots in `@scope/pkg` would break as field names),
  envKeys[] (NAMES only, never values), missingEnvKeys[], tests[]
  ({name, file, status, durationMs, error{message, signature}}),
  collectorError?, summary? }`
- **rejected_events**: what the server refused, with the exact reason
  (re-redacted on display).
- **projects**: `{ _id, name, requiredEnvKeys[] }`.

## How MongoDB is used

- **Schema validation** — `$jsonSchema` on `events` and `runs` (created by the
  idempotent `npm run db:setup`, applied on every server boot): even a buggy
  writer cannot store a contract-breaking document (verified: error code 121).
- **Indexes** — one per question: `{eventId:1}` unique (idempotency);
  `{projectId, startedAt:-1}` (latest runs); `{projectId, status, startedAt:-1}`
  (filtered lists + last-good-run); `{projectId, "tests.name":1}` (flaky
  history); `{projectId, changedFiles:1}` (file correlation);
  `{projectId, "tests.error.signature":1}` (recurring failures).
  `explain()` shows the latest-runs query as `LIMIT → FETCH → IXSCAN`.
- **Aggregation** — the analysis core: per-test history pipelines, the flaky
  check (`$group` by test + commitSha), file fail-rates
  (`$unwind changedFiles → $group`), and the culprit LIFT score (one
  `$facet` for totals/test/file/co-occurrence stats).
- **Change streams** — `GET /stream` pushes new/changed runs to the dashboard
  live (replica sets only; the server falls back to polling and tells you to
  use Atlas otherwise).
- **Idempotent ingestion** — `$setOnInsert` + upsert + unique index: the same
  event sent twice is stored once; the run upsert also repairs a crash
  between the two stores.

## Limitations (honest)

- **Confidence depends on history**: verdicts are `low` below 5 prior runs,
  `high` above 15. Fresh projects get honest "unknown" answers, not guesses.
- Culprit ranking ranks only the commits **between the last good run and the
  failure** — it cannot see changes that were never recorded.
- The flaky verdict needs the same commit to have both outcomes; a first-time
  flake on a brand-new commit looks like a regression.
- The safety-checked LLM summary is strict: any number/file/sha it writes that
  is not in the evidence discards the whole LLM text (falls back to the
  template). Honest beats fluent.
- Single-branch thinking: history comparisons are project-scoped
  (branch-scoped only in culprit baselines).
- The in-memory fallback is for development only — data dies with the process.

## Future work

- A **GitHub Action**: run the collector on every push and PR.
- A **CLI release gate**: `traceback release-gate --project shop-api` exits
  non-zero when the release check says HIGH/BLOCKED — wire it between CI and
  deploy.
- Branch-aware baselines everywhere, and culprit ranking that learns lift
  per test×file pair over longer windows.
- Slack/Teams notifications on new HIGH release risks.

## Repo layout

```
sample-project/   shop-api + Jest tests + git repo + break-on-purpose scenarios
collector/        traceback CLI: run / resend (zero dependencies)
server/           Express + mongodb driver: ingest, analysis, SSE, summary
dashboard/        React + Vite: timeline, run detail, culprits, release check
scripts/          seeder, demo scenarios, demo.md, one-command demo scripts
```

Run the tests: `server: npm test` (unit) · `npm run test:api` ·
`npm run test:analysis` · `sample-project: npm test`.
