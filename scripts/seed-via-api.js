// Replay the seeded 30-day history through a RUNNING TraceBack server.
//
// The dashboard needs seeded data inside the server the browser talks to —
// and the only contract-clean way into that database is POST /events.
// Usage:
//   1. start the server          cd server && npm start
//   2. replay the history        node scripts/seed-via-api.js
// Options: --server http://localhost:4000   --project shop-api
//
// Re-runnable: the ciRunIds are stable ("seedlive-<i>"), so every event gets
// the same eventId and the server's idempotency dedupes the replay.

const { buildSeededRuns } = require("./seed");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg("server", "http://localhost:4000").replace(/\/$/, "");
const PROJECT_ID = arg("project", "shop-api");

// Convert a seeded run document into a contract-valid event payload.
function runToEvent(run, index) {
  const iso = (d) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
  return {
    projectId: run.projectId,
    type: "run.completed",
    timestamp: iso(run.startedAt),
    payload: {
      projectName: PROJECT_ID,
      requiredEnvKeys: ["DATABASE_URL", "STRIPE_KEY"],
      commitSha: run.commitSha,
      branch: run.branch,
      author: run.author,
      ciRunId: `seedlive-${index}`,
      attempt: 1,
      startedAt: iso(run.startedAt),
      finishedAt: iso(run.finishedAt),
      status: run.status,
      commits: run.commits,
      changedFiles: run.changedFiles,
      dependencies: run.dependencies,
      envKeys: run.envKeys, // names only — the seeded docs never carry values
      missingEnvKeys: run.missingEnvKeys || [],
      tests: run.tests,
      source: run.source,
      ...(run.collectorError ? { collectorError: run.collectorError } : {}),
    },
  };
}

async function main() {
  const runs = buildSeededRuns().map((run) => ({ ...run, projectId: PROJECT_ID }));
  console.log(`Replaying ${runs.length} seeded runs into ${BASE} (project "${PROJECT_ID}")...`);

  let stored = 0;
  let duplicates = 0;
  let failed = 0;
  for (let i = 0; i < runs.length; i++) {
    const event = runToEvent(runs[i], i);
    try {
      const res = await fetch(`${BASE}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) stored += 1;
      else if (res.status === 200 && body.status === "duplicate_ignored") duplicates += 1;
      else {
        failed += 1;
        console.error(`  run ${i} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  run ${i} -> ${err.message} (is the server running?)`);
    }
  }

  console.log(`Done: ${stored} stored, ${duplicates} duplicates ignored, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("seed-via-api failed:", err);
  process.exit(1);
});
