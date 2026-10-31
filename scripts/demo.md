# Errors Everywhere — 5-minute demo script

Everything runs from the repo root. One-time setup (see README):

```bash
cd server  && npm install && cp .env.example .env   # Atlas URI goes here
cd dashboard && npm install
cd server && npm start          # terminal 1 (in-memory fallback works)
cd dashboard && npm run dev     # terminal 2 → http://localhost:5173
npm run demo:seed               # terminal 3 — replays 30 days of history
```

Rehearse from scratch any time: `npm run demo:reset` (with Atlas it also
wipes + reseeds automatically; with the in-memory fallback it prints the
2-step server restart).

---

## 0:00–0:30 — Intro

> "Every CI run dies with the same three questions: **why did it fail**, **what
> changed since it last worked**, and **is it safe to release** — and for
> commits: **which one broke it?** Answering means digging through logs and
> replaying pipelines. Errors Everywhere is a flight recorder: every run lands in
> MongoDB once, and those four answers come back instantly, with evidence."

Point at the timeline: 40 seeded runs over 30 days — the tool's memory.

## 0:30–1:00 — A healthy run, live

```bash
npm run demo:healthy
```

- The green run **slides into the timeline without a refresh** (SSE + MongoDB
  change streams).
- Show the raw document in MongoDB (Compass or `mongosh`):
  `db.runs.find().sort({startedAt:-1}).limit(1)` — the normalized contract:
  commit, author, commits[], changedFiles[], dependencies[] (an **array** —
  dots in `@scope/pkg` would break as field names), tests[] with error
  signatures, `envKeys` — **names only, never values**.

## 1:00–2:15 — Scenario F: which commit broke it?

```bash
npm run demo:culprit
```

Three commits landed together (README, cart tweak, payment culprit) and one
test run covers all of them — the situation where "which commit?" is hard.

- The red run appears live; open it.
- **Culprit Ranking** (our USP): the payment.js commit is on top with the
  biggest bar; the README commit is at 0%. Every reason is a fact from
  history: *"src/payment.js changes preceded 'payment charges card' failures
  in 6 of 12 past runs"* — the LIFT score over earlier runs, no re-runs.
- **Why it failed**: verdict `new regression`, confidence `high`, the
  "Seen 6 times before…" box.
- **What changed**: side-by-side against the last good run.
- **Release check**: HIGH, blocked, reasons with points.
- Say: *"git bisect rebuilds and retests over and over — we rank suspects
  instantly from history we already stored."*

## 2:15–3:45 — Failure cases, one command each

```bash
npm run demo:duplicate         # same event twice -> stored ONCE
npm run demo:bad-event         # no projectId -> 400 + rejected_events
npm run demo:collector-crash   # jest cannot start -> grey "errored" run
npm run demo:invalid-config    # STRIPE_KEY missing -> environment_problem
```

- **Duplicate**: the toast says *"Duplicate ignored — nothing changed"* and
  the run count is unchanged — idempotent ingestion
  (`eventId = sha1(project:commit:ciRunId:attempt)`).
- **Bad event**: 400 with a clear reason; open the **Rejected events** page —
  the server keeps what it refused and why. Never a silent drop.
- **Collector crash**: grey run with the collectorError — the recorder
  itself failing is a fact worth recording.
- **Invalid config**: diagnosis says `environment_problem`, release-check
  adds **+20** for the missing env var — the tool blames the environment
  before it blames a commit.

## 3:45–4:30 — Why MongoDB (and why history makes it smarter)

- Two indexes (run `db.runs.getIndexes()` in `mongosh`):
  - `{projectId: 1, startedAt: -1}` — "latest runs" in one index scan;
  - `{projectId: 1, "tests.error.signature": 1}` — "have we seen this
    failure before?" (the recurring-failure verdicts).
- One aggregation — the file failRate that feeds culprit ranking:
  `db.runs.aggregate([{$match: {projectId:"shop-api"}}, {$unwind: "$changedFiles"},
  {$group: {_id: "$changedFiles", runs: {$sum:1}, failures: {$sum: {$cond:
  [{$eq:["$status","failed"]},1,0]}}}}])` — every run makes these numbers
  better. **The tool gets sharper with every build, with zero re-runs.**

## 4:30–5:00 — Optional: plain English

Open a failed run → **Explain in plain English**.

> "Rules and MongoDB history find the answer; the LLM only translates
> verified evidence. Every number it writes is checked against the stored
> facts — if it invents so much as a file name, we discard it and show the
> template instead."

The badge says **Template** (LLM off) or **AI-written, verified against
evidence** (LLM on via `LLM_ENABLED=true` + `API_KEY`).

---

## Cheat sheet

| Command | What it shows |
| --- | --- |
| `npm run demo:seed` | replay 30 days of history into the running server |
| `npm run demo:healthy` | green run, live update |
| `npm run demo:culprit` | scenario F + culprit ranking |
| `npm run demo:duplicate` | idempotent ingestion |
| `npm run demo:bad-event` | 400 + rejected_events page |
| `npm run demo:collector-crash` | grey errored run with collectorError |
| `npm run demo:invalid-config` | environment_problem + risk +20 |
| `npm run demo:reset` | clean, seeded state for the next rehearsal |
