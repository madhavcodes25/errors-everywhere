// Smoke check for the TraceBack server — verifies the core contract end to end:
//   ingest -> idempotency -> rejection of bad input -> redaction ->
//   diagnosis -> changes -> culprits -> release-check
//
// Usage:
//   1. start the server:   cd server && npm start
//   2. run this script:    node ../scripts/smoke.js          (from server/)
//                          node scripts/smoke.js             (from traceback/)
// Optional: BASE=http://localhost:4000 node scripts/smoke.js

const BASE = process.env.BASE || "http://localhost:4000";

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json };
}

// A realistic failing run: pricing bug + a missing env key. The error message
// deliberately contains a secret ("password=hunter2") to prove redaction.
// A FRESH project id per execution keeps the check repeatable: the analysis
// always sees a brand-new project (so "new failure" is always true).
function makeEvent() {
  const startedAt = new Date();
  const finishedAt = new Date(startedAt.getTime() + 3000);
  const projectId = `shop-api-smoke-${startedAt.getTime().toString(36)}`;
  return {
    projectId,
    type: "run.completed",
    timestamp: startedAt.toISOString(),
    payload: {
      projectName: projectId,
      requiredEnvKeys: ["DATABASE_URL", "PAYMENT_API_KEY"],
      commitSha: "abc123def4567890abcdef1234567890abcdef12",
      branch: "main",
      author: "Smoke Tester",
      ciRunId: `smoke-${startedAt.getTime()}`, // unique per execution
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status: "failed",
      commits: [
        {
          sha: "abc123def4567890abcdef1234567890abcdef12",
          message: "smoke: refactor discount calculation",
          author: "Smoke Tester",
          files: ["src/pricing.js", "tests/pricing.test.js"],
        },
      ],
      dependencies: [{ name: "jest", version: "29.7.0" }],
      envKeys: ["DATABASE_URL"], // PAYMENT_API_KEY intentionally missing
      tests: [
        {
          name: "pricing > applyDiscount rounds half up to 2 decimals",
          file: "tests/pricing.test.js",
          status: "failed",
          durationMs: 12,
          error: { message: "Expected 33.72 but received 33.71 (password=hunter2)" },
        },
        {
          name: "cart > adds a new item with quantity",
          file: "tests/cart.test.js",
          status: "passed",
          durationMs: 5,
        },
      ],
      source: { ci: "smoke-script" },
    },
  };
}

async function main() {
  console.log(`Smoke check against ${BASE}\n`);

  // 0) Is the server up?
  let health;
  try {
    health = await api("GET", "/projects/shop-api/runs");
  } catch (err) {
    console.error(`Cannot reach ${BASE} — is the server running? (cd server && npm start)`);
    process.exit(1);
  }
  check("server is up", health.status === 200);

  // 1) Ingest a failing run.
  const event = makeEvent();
  const projectId = event.projectId;
  const first = await api("POST", "/events", event);
  check("POST /events accepts a valid event (201 {status:stored})", first.status === 201 && first.json.status === "stored", `got ${first.status} ${JSON.stringify(first.json)}`);
  const runId = first.json && first.json.runId;

  // 2) Idempotency: same event again must NOT error and NOT create a new run.
  const second = await api("POST", "/events", event);
  check("POST /events is idempotent (200 duplicate_ignored)", second.status === 200 && second.json.status === "duplicate_ignored", `got ${second.status} ${JSON.stringify(second.json)}`);

  // 3) Bad input is rejected loudly.
  const bad = await api("POST", "/events", { projectId: "", type: "nonsense" });
  check("POST /events rejects bad input (400 + reason)", bad.status === 400 && typeof bad.json.error === "string", `got ${bad.status} ${JSON.stringify(bad.json)}`);

  // 4) Diagnosis: failed test classified, confidence + evidence present,
  //    secrets redacted.
  const diagnosis = await api("GET", `/runs/${runId}/diagnosis`);
  check("GET /runs/:id/diagnosis works (200)", diagnosis.status === 200, `got ${diagnosis.status}`);
  const dTests = (diagnosis.json && diagnosis.json.tests) || [];
  check("failed test classified environment_problem (env keys missing)", dTests.some((t) => t.verdict === "environment_problem"),
    `verdicts: ${dTests.map((t) => t.verdict).join(", ")}`);
  check("diagnosis includes confidence + evidence (history, fileRiskRates, seenBefore)",
    ["low", "medium", "high"].includes(diagnosis.json && diagnosis.json.confidence) &&
      dTests.every((t) => t.evidence && Array.isArray(t.evidence.history) && t.evidence.fileRiskRates && typeof t.evidence.seenBefore === "object"));
  const rawDiagnosis = JSON.stringify(diagnosis.json);
  check("no secrets leak into analysis output", !rawDiagnosis.includes("hunter2"));
  const storedRuns = await api("GET", `/projects/${projectId}/runs`);
  const storedFailed = ((storedRuns.json.runs[0] || {}).tests || []).find((t) => t.status === "failed");
  check("secrets are redacted before storage (error message shows [REDACTED])",
    storedFailed && storedFailed.error && storedFailed.error.message.includes("[REDACTED]") && !storedFailed.error.message.includes("hunter2"),
    `message=${storedFailed && storedFailed.error && storedFailed.error.message}`);

  // 5) Changes: no earlier good run yet -> honest note, low confidence.
  const changes = await api("GET", `/runs/${runId}/changes`);
  check("GET /runs/:id/changes works (200)", changes.status === 200, `got ${changes.status}`);
  check("changes is honest about missing baseline", changes.json && changes.json.againstRunId === null && typeof changes.json.note === "string");
  check("changes carries a confidence label", ["low", "medium", "high"].includes(changes.json && changes.json.confidence));

  // 6) Culprits: the commit that touched the failing file must rank #1.
  const culprits = await api("GET", `/runs/${runId}/culprits`);
  check("GET /runs/:id/culprits works (200)", culprits.status === 200, `got ${culprits.status}`);
  const top = culprits.json && culprits.json.candidates && culprits.json.candidates[0];
  check("top culprit is the commit that touched the failing file", top && top.sha === "abc123def4567890abcdef1234567890abcdef12" && top.reasons.length > 0, `top: ${JSON.stringify(top)}`);

  // 7) Release check: points-based score, HIGH + blocked for a red run.
  const release = await api("GET", `/projects/${projectId}/release-check`);
  check("GET /projects/:id/release-check works (200)", release.status === 200, `got ${release.status}`);
  check("release-check says HIGH + blocked for a failing latest run",
    release.json && release.json.level === "HIGH" && release.json.blocked === true,
    `score=${release.json && release.json.score} level=${release.json && release.json.level}`);
  check("release-check reasons carry text + points",
    release.json && Array.isArray(release.json.reasons) && release.json.reasons.length > 0 &&
      release.json.reasons.every((r) => typeof r.text === "string" && typeof r.points === "number"));

  // 8) Summary endpoint: template source (LLM disabled in this environment),
  //    then a second call must return the CACHED summary (same generatedAt).
  const summary = await api("POST", `/runs/${runId}/summary`, {});
  check("POST /runs/:id/summary works (200, template source, no secrets)",
    summary.status === 200 && summary.json.summary && typeof summary.json.summary.text === "string" &&
      summary.json.summary.source === "template" && !JSON.stringify(summary.json).includes("hunter2"),
    `got ${summary.status} source=${summary.json.summary && summary.json.summary.source}`);
  const summary2 = await api("POST", `/runs/${runId}/summary`, {});
  check("second summary call returns the cached summary (no new generation)",
    summary2.status === 200 && summary2.json.cached === true &&
      summary2.json.summary.generatedAt === summary.json.summary.generatedAt,
    `cached=${summary2.json.cached}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("smoke check crashed:", err);
  process.exit(1);
});
