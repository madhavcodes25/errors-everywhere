// npm run test:api — PART 3 acceptance checks, proven against a REAL server
// instance (built in-process, listening on an ephemeral port).
//
// Uses MONGODB_URI if set (Atlas), else a temporary in-memory replica set.
// All test data uses a unique projectId and is cleaned up at the end.

const config = require("../src/config");
const { connectDatabase, safeUri } = require("../src/db");
const { buildApp } = require("../src/app");
const { setupDatabase } = require("../src/dbSetup");
const { computeEventId } = require("../src/ingest");

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

// A contract-valid failing run; every field the manual validation requires.
function validEvent(projectId, ciRunId, commitSha) {
  const startedAt = new Date();
  return {
    projectId,
    type: "run.completed",
    timestamp: startedAt.toISOString(),
    payload: {
      projectName: projectId,
      requiredEnvKeys: ["DATABASE_URL", "STRIPE_KEY"],
      commitSha,
      branch: "main",
      author: "API Test",
      ciRunId,
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date(startedAt.getTime() + 1500).toISOString(),
      status: "failed",
      commits: [{ sha: commitSha, message: "test: api check", author: "API Test", files: ["src/x.js"] }],
      changedFiles: ["src/x.js"],
      dependencies: [{ name: "lodash", version: "^4.17.21" }],
      envKeys: ["DATABASE_URL", "STRIPE_KEY"],
      missingEnvKeys: [],
      tests: [
        { name: "t1 fails", file: "tests/t1.test.js", status: "failed", durationMs: 5, error: { message: "expected 5 to be 3" } },
        { name: "t2 passes", file: "tests/t2.test.js", status: "passed", durationMs: 3 },
      ],
      source: { ci: "test-api" },
    },
  };
}

// Walk a query plan tree and collect every stage node.
function collectStages(plan, into = []) {
  if (!plan) return into;
  into.push(plan);
  if (plan.inputStage) collectStages(plan.inputStage, into);
  if (plan.inputStages) plan.inputStages.forEach((s) => collectStages(s, into));
  return into;
}

async function main() {
  const { client, db, collections, memoryReplSet, isMemory } = await connectDatabase();
  console.log(
    `test:api against ${isMemory ? "in-memory replica set" : safeUri(config.mongoUri)} / db "${db.databaseName}"\n`
  );

  // --- db:setup twice: must not error ------------------------------------
  try {
    await setupDatabase(db);
    await setupDatabase(db);
    check("db:setup runs twice with no errors (idempotent)", true);
  } catch (err) {
    check("db:setup runs twice with no errors (idempotent)", false, err.message);
  }

  const app = buildApp(collections, db);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const projectId = `api-test-${Date.now().toString(36)}`;
  const commitSha = require("crypto").createHash("sha1").update(projectId).digest("hex");
  const event = validEvent(projectId, "run-1", commitSha);
  const eventId = computeEventId({ projectId, commitSha, ciRunId: "run-1", attempt: 1 });
  const runId = "run_" + eventId.slice(0, 12);

  // --- 0) health -----------------------------------------------------------
  const health = await api(base, "GET", "/health");
  check("GET /health -> 200 {status: ok}", health.status === 200 && health.json.status === "ok",
    `got ${health.status} ${JSON.stringify(health.json)}`);

  // --- 1) valid event -> 201, one event + one run --------------------------
  const first = await api(base, "POST", "/events", event);
  const evCount = await collections.events.countDocuments({ eventId });
  const runCount = await collections.runs.countDocuments({ _id: runId });
  check("valid event -> 201 {status: stored, runId}", first.status === 201 && first.json.status === "stored" && first.json.runId === runId,
    `got ${first.status} ${JSON.stringify(first.json)}`);
  check("exactly one document in events and one in runs", evCount === 1 && runCount === 1,
    `events=${evCount} runs=${runCount}`);

  // --- 2) same event again -> 200 duplicate_ignored, counts unchanged ------
  const second = await api(base, "POST", "/events", event);
  const evCount2 = await collections.events.countDocuments({ eventId });
  const runCount2 = await collections.runs.countDocuments({ _id: runId });
  check("same event again -> 200 {status: duplicate_ignored}", second.status === 200 && second.json.status === "duplicate_ignored",
    `got ${second.status} ${JSON.stringify(second.json)}`);
  check("counts unchanged after duplicate", evCount2 === 1 && runCount2 === 1,
    `events=${evCount2} runs=${runCount2}`);

  // --- 3) missing projectId -> 400 + rejected_events ------------------------
  const rejectedBefore = await collections.rejected.countDocuments({});
  const noProject = await api(base, "POST", "/events", { type: "run.completed", payload: event.payload });
  check("missing projectId -> 400 with clear message",
    noProject.status === 400 && /Missing required field: projectId/.test((noProject.json || {}).error || ""),
    `got ${noProject.status} ${JSON.stringify(noProject.json)}`);
  check("bad body stored in rejected_events with a reason",
    (await collections.rejected.countDocuments({})) === rejectedBefore + 1);

  // --- 4) wrong type value -> rejected cleanly ------------------------------
  const badType = await api(base, "POST", "/events", { projectId, type: "nonsense", payload: event.payload });
  check("wrong type value -> 400, rejected cleanly",
    badType.status === 400 && /Invalid field type/.test((badType.json || {}).error || ""),
    `got ${badType.status} ${JSON.stringify(badType.json)}`);
  check("rejected_events grew again",
    (await collections.rejected.countDocuments({})) === rejectedBefore + 2);

  // --- 5) GET /projects/:id/runs newest first, ?limit and ?status -----------
  const event2 = validEvent(projectId, "run-2", commitSha);
  event2.payload.startedAt = new Date(Date.now() + 3600e3).toISOString();
  event2.payload.finishedAt = new Date(Date.now() + 3600e3 + 1500).toISOString();
  const runId2 = "run_" + computeEventId({ projectId, commitSha, ciRunId: "run-2", attempt: 1 }).slice(0, 12);
  await api(base, "POST", "/events", event2);

  const list = await api(base, "GET", `/projects/${projectId}/runs`);
  check("GET /projects/:id/runs newest first",
    list.status === 200 && list.json.runs.length === 2 && list.json.runs[0]._id === runId2,
    `order: ${(list.json.runs || []).map((r) => r._id).join(", ")}`);
  const filtered = await api(base, "GET", `/projects/${projectId}/runs?limit=1&status=failed`);
  check("?limit and ?status work", filtered.json.runs.length === 1 && filtered.json.runs[0]._id === runId2,
    `got ${(filtered.json.runs || []).length} runs`);

  // --- 6) $jsonSchema validator enforced by the database itself -------------
  let validatorFired = false;
  try {
    // Bypasses the manual checks entirely: the DB must refuse this.
    await collections.events.insertOne({ eventId: 123, projectId: "", type: "nope", timestamp: "not-a-date" });
  } catch (err) {
    validatorFired = err.code === 121 || /document failed validation/i.test(err.message || "");
  }
  check("$jsonSchema validator rejects contract-breaking writes at the DB level", validatorFired);

  // --- 7) explain(): the "latest runs" query uses the compound index --------
  const explain = await collections.runs.find({ projectId }).sort({ startedAt: -1 }).limit(20).explain();
  const winning = explain.queryPlanner && explain.queryPlanner.winningPlan;
  const stages = collectStages(winning).map((s) => s.stage);
  const ixscan = collectStages(winning).find((s) => s.stage === "IXSCAN");
  const keyOk =
    ixscan && ixscan.keyPattern && ixscan.keyPattern.projectId === 1 && ixscan.keyPattern.startedAt === -1;
  check("explain(): latest-runs query uses IXSCAN {projectId:1, startedAt:-1} (no COLLSCAN/SORT)", Boolean(keyOk),
    `plan: ${stages.join(" -> ")}`);
  console.log(`        winning plan: ${stages.join(" -> ")}`);
  if (ixscan) console.log(`        index used:  ${JSON.stringify(ixscan.keyPattern)} ${ixscan.direction || ""}`);

  // --- cleanup: remove this test run's artifacts ----------------------------
  await collections.events.deleteMany({ projectId });
  await collections.runs.deleteMany({ projectId });
  await collections.rejected.deleteMany({ "rawBody.projectId": projectId });

  server.close();
  await client.close();
  // Stop the temporary in-memory mongod (if we started one) so the process
  // can actually exit instead of lingering on the child process.
  if (memoryReplSet) await memoryReplSet.stop();
  console.log(`\n${passed} passed, ${failed} failed (test data cleaned up)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("test:api crashed:", err);
  process.exit(1);
});
