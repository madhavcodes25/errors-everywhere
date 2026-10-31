// npm run test:analysis — PART 4 acceptance checks against SEEDED data.
//
// Runs the seeder into a fresh in-memory replica set, then simulates the
// demo scenario runs (B logic bug, E bad config, C dependency bump) through
// the REAL ingest pipeline, and asserts the analysis engine's answers.
// No HTTP server needed: routes just call these same functions.

const crypto = require("crypto");
const { connectDatabase } = require("../src/db");
const { ingestEvent } = require("../src/ingest");
const { diagnoseRun } = require("../src/analysis/diagnose");
const { buildChanges } = require("../src/analysis/changes");
const { buildReleaseCheck } = require("../src/analysis/releaseCheck");
const { rankCulprits } = require("../src/analysis/culprits");
const { buildEvidence } = require("../src/analysis/evidence");
const { generateSummary } = require("../src/analysis/summarize");
const { seedDatabase, TEST_SPECS, DEPS_BASE } = require("../../scripts/seed");

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

// Deterministic fake commit sha for simulated scenario runs.
function fakeSha(key) {
  return crypto.createHash("sha1").update("traceback-analysis:" + key).digest("hex");
}

// Build a contract-valid event like the collector would send it.
// failedTests: [{ name, message }] — those tests fail, all others pass.
// commits: optional full commit list (multi-commit runs, e.g. scenario F);
//          defaults to a single commit built from commitMessage + files.
function scenarioEvent({ projectId = "shop-api", ciRunId, commitMessage, files, deps, envKeys, failedTests, commits }) {
  const startedAt = new Date();
  const commitSha = fakeSha(ciRunId);
  const commitList = commits || [{ sha: commitSha, message: commitMessage, author: "Demo Developer", files }];
  return {
    projectId,
    type: "run.completed",
    timestamp: startedAt.toISOString(),
    payload: {
      projectName: projectId,
      requiredEnvKeys: ["DATABASE_URL", "STRIPE_KEY"],
      commitSha: commitList[commitList.length - 1].sha,
      branch: "main",
      author: "Demo Developer",
      ciRunId,
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date(startedAt.getTime() + 2000).toISOString(),
      status: failedTests.length > 0 ? "failed" : "passed",
      commits: commitList,
      changedFiles: [...new Set(commitList.flatMap((c) => c.files))],
      dependencies: deps || DEPS_BASE.map((d) => ({ ...d })),
      envKeys: envKeys || ["DATABASE_URL", "STRIPE_KEY"],
      missingEnvKeys: [],
      tests: TEST_SPECS.map((spec) => {
        const failed = failedTests.find((t) => t.name === spec.name);
        const test = { name: spec.name, file: spec.file, status: failed ? "failed" : "passed", durationMs: spec.base };
        if (failed) {
          test.error = { message: failed.message }; // server computes the signature
        }
        return test;
      }),
      source: { ci: "test-analysis" },
    },
  };
}

async function main() {
  // forceMemory: analysis tests are always deterministic and never touch Atlas.
  const { client, db, collections, memoryReplSet } = await connectDatabase({ forceMemory: true });
  console.log("test:analysis on a fresh in-memory replica set (seeded data)\n");

  await seedDatabase(db);
  const post = (event) => ingestEvent(collections, event);

  // ---------------------------------------------------------------------
  // PART 5 — culprit ranking, run FIRST so scenario F gets its clean demo
  // window (last good run = seeded head, candidates = F's 3 commits only).
  // ---------------------------------------------------------------------
  console.log("PART 5 — culprit ranking (scenario F on the clean seeded history):");

  const fEvent = scenarioEvent({
    ciRunId: "scenario-F",
    commits: [
      { sha: fakeSha("scenario-F-1"), message: "docs: document checkout fees", author: "Alice Chen", files: ["README.md"] },
      { sha: fakeSha("scenario-F-2"), message: "refactor: clarify cart item shape", author: "Diego Ruiz", files: ["src/cart.js"] },
      { sha: fakeSha("scenario-F-3"), message: "fix: apply fee after tax in checkout", author: "Marcus Webb", files: ["src/payment.js"] },
    ],
    failedTests: [{ name: "payment charges card", message: "payment charges card: expected charge 102.9 but got 100" }],
  });
  const fStored = await post(fEvent);
  const fStarted = Date.now();
  const fCulprits = await rankCulprits(collections, fStored.body.runId);
  const fElapsedMs = Date.now() - fStarted;
  const fTop = fCulprits.body.candidates[0];
  const fReadme = fCulprits.body.candidates.find((c) => c.files.includes("README.md"));

  check("scenario F: the payment.js commit ranks 1 with the highest matchPercent (100%)",
    fTop && fTop.rank === 1 && fTop.sha === fakeSha("scenario-F-3") &&
      fTop.matchPercent === Math.max(...fCulprits.body.candidates.map((c) => c.matchPercent)),
    `ranking: ${JSON.stringify(fCulprits.body.candidates.map((c) => ({ rank: c.rank, sha: c.sha.slice(0, 7), pct: c.matchPercent })))}`);
  check("scenario F: the README commit sits near 0%",
    fReadme && fReadme.matchPercent <= 5,
    `pct=${fReadme && fReadme.matchPercent}`);
  check("scenario F: reasons cite past-run counts ('changes preceded ... in N of M past runs')",
    fTop.reasons.some((r) => /changes preceded ".*" failures in \d+ of \d+ past runs/.test(r)),
    fTop.reasons.join(" | "));
  check("scenario F: every evidenceRunId really exists in the database",
    fTop.evidenceRunIds.length > 0 &&
      (await collections.runs.countDocuments({ _id: { $in: fTop.evidenceRunIds } })) === fTop.evidenceRunIds.length,
    `n=${fTop.evidenceRunIds.length}`);
  check("culprit ranking responds in well under 500 ms on the seeded data",
    fElapsedMs < 500,
    `${fElapsedMs} ms`);

  // Integrations on the same clean window:
  const fDiag = await diagnoseRun(collections, fStored.body.runId);
  check("integration: diagnosis mentions the top culprit when matchPercent > 50",
    fDiag.body.note && /Most likely culprit/.test(fDiag.body.note),
    `note=${fDiag.body.note}`);
  const fRelease = await buildReleaseCheck(collections, "shop-api", fStored.body.runId);
  check("integration: release-check adds +10 for the unfixed high-suspicion commit (>60%)",
    fRelease.body.reasons.some((r) => /Unfixed high-suspicion commit/.test(r.text) && r.points === 10),
    `reasons: ${fRelease.body.reasons.map((r) => r.text).join(" | ")}`);

  // Remove the simulated F run so the Part 4 checks below run against the
  // pristine seeded history (B must again be the first failure after seed).
  await collections.runs.deleteMany({ "source.seed": { $ne: true } });

  console.log("\nPART 4 — diagnosis / changes / release-check:");

  // ---------------------------------------------------------------------
  // Acceptance 1: Scenario B run -> "payment charges card" is a
  // new_regression, with src/payment.js failRate near 0.6 in the evidence.
  // ---------------------------------------------------------------------
  const bEvent = scenarioEvent({
    ciRunId: "scenario-B",
    commitMessage: "fix: drop the processing fee at checkout",
    files: ["src/payment.js"],
    failedTests: [{ name: "payment charges card", message: "payment charges card: expected charge 102.9 but got 100" }],
  });
  const bStored = await post(bEvent);
  const bDiag = await diagnoseRun(collections, bStored.body.runId);
  const charges = bDiag.body.tests.find((t) => t.name === "payment charges card");

  check("scenario B: 'payment charges card' classified new_regression", charges && charges.verdict === "new_regression",
    charges ? `verdict=${charges.verdict}` : "test missing from diagnosis");
  const paymentRisk = charges && charges.evidence.fileRiskRates["src/payment.js"];
  check("scenario B: src/payment.js failRate near 0.6 in evidence",
    paymentRisk && paymentRisk.failRate > 0.5 && paymentRisk.failRate < 0.8,
    paymentRisk ? `failRate=${paymentRisk.failRate} (${paymentRisk.failures}/${paymentRisk.runs} runs)` : "no file risk attached");
  check("scenario B: confidence labels present (top-level + per-test)",
    ["low", "medium", "high"].includes(bDiag.body.confidence) && ["low", "medium", "high"].includes(charges.confidence),
    `top=${bDiag.body.confidence} test=${charges && charges.confidence}`);
  check("scenario B: known-fix evidence (same signature seen 6x within the 30-run history window, later passing run found)",
    charges.evidence.seenBefore.count === 6 && Boolean(charges.evidence.seenBefore.fixedBy),
    `count=${charges.evidence.seenBefore.count} fixedBy=${JSON.stringify(charges.evidence.seenBefore.fixedBy && charges.evidence.seenBefore.fixedBy.runId)}`);

  // ---------------------------------------------------------------------
  // Acceptance 2: "refund works" -> classified flaky (seeded run that failed
  // it; the same commit has passes AND failures in history).
  // ---------------------------------------------------------------------
  const refundRun = await collections.runs.findOne({
    "source.seed": true,
    status: "failed",
    "tests.name": "refund works",
  });
  const refundDiag = await diagnoseRun(collections, refundRun._id);
  const refundTest = refundDiag.body.tests.find((t) => t.name === "refund works");
  check("'refund works' classified flaky (pass+fail on the same commit)", refundTest && refundTest.verdict === "flaky",
    refundTest ? `verdict=${refundTest.verdict}` : "test missing");

  // ---------------------------------------------------------------------
  // Acceptance 3: a run with STRIPE_KEY missing -> environment_problem.
  // ---------------------------------------------------------------------
  const eEvent = scenarioEvent({
    ciRunId: "scenario-E",
    commitMessage: "no code change (environment only)",
    files: [],
    envKeys: ["DATABASE_URL"], // STRIPE_KEY missing
    failedTests: [{ name: "payment requires STRIPE_KEY to be configured", message: "STRIPE_KEY is not configured" }],
  });
  const eStored = await post(eEvent);
  const eDiag = await diagnoseRun(collections, eStored.body.runId);
  const eTest = eDiag.body.tests.find((t) => t.name === "payment requires STRIPE_KEY to be configured");
  check("STRIPE_KEY missing -> environment_problem", eTest && eTest.verdict === "environment_problem",
    eTest ? `verdict=${eTest.verdict}` : "test missing");

  // ---------------------------------------------------------------------
  // Acceptance 4: /changes lists the scenario C major dependency bump.
  // ---------------------------------------------------------------------
  const cEvent = scenarioEvent({
    ciRunId: "scenario-C",
    commitMessage: "chore(deps): upgrade express to v5 and simplify discount tiers",
    files: ["package.json", "src/discount.js"],
    deps: DEPS_BASE.map((d) => (d.name === "express" ? { name: "express", version: "^5.1.0" } : { ...d })),
    failedTests: [{ name: "applies tier discounts for larger carts", message: "tier discount for total 50 should be 5% but got 0%" }],
  });
  const cStored = await post(cEvent);
  const cChanges = await buildChanges(collections, cStored.body.runId);
  const expressChange = cChanges.body.dependencies.changed.find((d) => d.name === "express");
  check("/changes lists the express major bump (^4.21.2 -> ^5.1.0, major: true)",
    expressChange && expressChange.from === "^4.21.2" && expressChange.to === "^5.1.0" && expressChange.major === true,
    JSON.stringify(expressChange));

  // ---------------------------------------------------------------------
  // Bonus (seeded pattern d): a THIRD failure with the discount rounding
  // signature is "seen 2 times before" and points at the later passing run.
  // ---------------------------------------------------------------------
  const dEvent = scenarioEvent({
    ciRunId: "scenario-discount-3rd",
    commitMessage: "refactor: touch discount rounding again",
    files: ["src/discount.js"],
    failedTests: [{ name: "applies a percentage discount with correct rounding", message: "discount rounding mismatch: got 33.71 but expected 33.72" }],
  });
  const dStored = await post(dEvent);
  const dDiag = await diagnoseRun(collections, dStored.body.runId);
  const dTest = dDiag.body.tests.find((t) => t.name === "applies a percentage discount with correct rounding");
  check("discount signature: 'seen 2 times before' with a later passing run as the known fix",
    dTest && dTest.evidence.seenBefore.count === 2 && Boolean(dTest.evidence.seenBefore.fixedBy) && dTest.explanation.includes("Seen 2 time(s) before"),
    `count=${dTest && dTest.evidence.seenBefore.count} explanation=${dTest && dTest.explanation.slice(-80)}`);

  // ---------------------------------------------------------------------
  // Acceptance 5: release-check HIGH + reasons for the bad run, LOW + no
  // reasons for the clean healthy run.
  // ---------------------------------------------------------------------
  const badRelease = await buildReleaseCheck(collections, "shop-api", bStored.body.runId);
  check("release-check: HIGH + blocked for the bad run, reasons listed",
    badRelease.body.level === "HIGH" && badRelease.body.blocked === true && badRelease.body.reasons.length >= 3,
    `score=${badRelease.body.score} level=${badRelease.body.level} reasons=${badRelease.body.reasons.length}`);
  console.log(`        reasons: ${badRelease.body.reasons.map((r) => `(+${r.points}) ${r.text}`).join(" | ")}`);

  const head = await collections.runs.find({ "source.seed": true }).sort({ startedAt: -1 }).limit(1).next();
  const cleanRelease = await buildReleaseCheck(collections, "shop-api", head._id);
  check("release-check: LOW, not blocked, no reasons for the clean healthy run",
    cleanRelease.body.level === "LOW" && cleanRelease.body.blocked === false && cleanRelease.body.reasons.length === 0,
    `score=${cleanRelease.body.score} reasons=${JSON.stringify(cleanRelease.body.reasons)}`);

  // ---------------------------------------------------------------------
  // Acceptance 6: a project with zero history returns low-confidence
  // answers, not errors.
  // ---------------------------------------------------------------------
  const zEvent = scenarioEvent({
    projectId: "zero-history-p4",
    ciRunId: "first-run",
    commitMessage: "feat: first commit",
    files: ["src/x.js"],
    failedTests: [{ name: TEST_SPECS[0].name, message: "expected 1 to be 2" }],
  });
  const zStored = await post(zEvent);
  const zDiag = await diagnoseRun(collections, zStored.body.runId);
  const zChanges = await buildChanges(collections, zStored.body.runId);
  const zRelease = await buildReleaseCheck(collections, "zero-history-p4");
  const zTest = zDiag.body.tests[0];
  check("zero history: diagnosis answers honestly (unknown) with low confidence, no error",
    zDiag.code === 200 && zTest.verdict === "unknown" && zDiag.body.confidence === "low" && zTest.confidence === "low",
    `code=${zDiag.code} verdict=${zTest.verdict} confidence=${zDiag.body.confidence}`);
  check("zero history: changes returns a clear message, not an error",
    zChanges.code === 200 && typeof zChanges.body.note === "string" && zChanges.body.confidence === "low",
    `code=${zChanges.code} note=${zChanges.body.note && zChanges.body.note.slice(0, 50)}`);
  check("zero history: release-check works with low confidence",
    zRelease.code === 200 && zRelease.body.confidence === "low",
    `code=${zRelease.code} confidence=${zRelease.body.confidence}`);

  // PART 5 edge cases (the main F scenario ran right after seeding above).
  console.log("\nPART 5 — edge cases:");
  const zCulprits = await rankCulprits(collections, zStored.body.runId);
  check("empty history: low-confidence result with a limited-history note, not an error",
    zCulprits.code === 200 && zCulprits.body.confidence === "low" &&
      /Limited history, ranking relies mostly on file\/test name matching/.test(zCulprits.body.note || ""),
    `code=${zCulprits.code} confidence=${zCulprits.body.confidence} note=${zCulprits.body.note}`);

  const headCulprits = await rankCulprits(collections, head._id);
  check("run with no failures: empty candidates list with a clear message",
    headCulprits.code === 200 && headCulprits.body.candidates.length === 0 &&
      /nothing to blame/i.test(headCulprits.body.note || ""),
    `candidates=${JSON.stringify(headCulprits.body.candidates)}`);

  // ---------------------------------------------------------------------
  // PART 7 — evidence object + summary caching (LLM disabled -> template).
  // ---------------------------------------------------------------------
  console.log("\nPART 7 — plain-English summary (LLM off = template):");
  const evidence = await buildEvidence(collections, bStored.body.runId);
  const evidenceJson = JSON.stringify(evidence);
  check("buildEvidence combines the four answers into one small facts-only JSON",
    evidence && evidence.runId === bStored.body.runId && Array.isArray(evidence.failedTests) &&
      evidence.failedTests.length > 0 && evidence.topCulprit && evidence.release &&
      typeof evidence.release.score === "number",
    `keys=${Object.keys(evidence).join(", ")} bytes=${evidenceJson.length}`);
  check("evidence contains no env var values (names only)",
    !/sk_test_|s3cretPass|:\/\//.test(evidenceJson),
    "scanned the JSON for secret-looking strings");

  const first = await generateSummary(collections, bStored.body.runId);
  const second = await generateSummary(collections, bStored.body.runId);
  check("first summary call generates with source 'template' (LLM_ENABLED not true)",
    first.code === 200 && first.body.cached === false && first.body.summary.source === "template" &&
      typeof first.body.summary.text === "string",
    `source=${first.body.summary && first.body.summary.source} cached=${first.body.cached}`);
  check("second call returns the CACHED summary (same hash, same generatedAt, no new generation)",
    second.code === 200 && second.body.cached === true &&
      second.body.summary.evidenceHash === first.body.summary.evidenceHash &&
      new Date(second.body.summary.generatedAt).toISOString() ===
        new Date(first.body.summary.generatedAt).toISOString(),
    `cached=${second.body.cached}`);
  check("summary text is grounded in the evidence (mentions run id and culprit)",
    first.body.summary.text.includes(bStored.body.runId.slice(0, 12)) &&
      first.body.summary.text.includes(evidence.topCulprit.sha.slice(0, 7)),
    first.body.summary.text.slice(0, 120));

  await client.close();
  if (memoryReplSet) await memoryReplSet.stop();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("test:analysis crashed:", err);
  process.exit(1);
});
