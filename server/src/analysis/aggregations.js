// MongoDB aggregation pipelines used by the analysis engine.
// Each function takes (collections, run, ...) and returns plain JSON — the
// classification logic itself lives in the pure functions in diagnose.js /
// releaseCheck.js so it stays easy to test.

const HISTORY_RUNS = 30; // "the last 30 earlier runs" per the contract

// 1) One test's history: the last 30 earlier runs of the project, unwound to
//    just this test, newest first. Pipeline per the contract:
//    $match project + earlier -> $sort -> $limit -> $unwind tests ->
//    $match test name -> $project status/commit/time.
async function testHistory(collections, run, testName) {
  return collections.runs
    .aggregate([
      { $match: { projectId: run.projectId, startedAt: { $lt: run.startedAt } } },
      { $sort: { startedAt: -1 } },
      { $limit: HISTORY_RUNS },
      { $unwind: "$tests" },
      { $match: { "tests.name": testName } },
      {
        $project: {
          _id: 0,
          runId: "$_id",
          commitSha: 1,
          status: "$tests.status",
          startedAt: 1,
          durationMs: "$tests.durationMs",
          error: "$tests.error",
          envKeys: 1, // NAMES only — lets the flaky rule compare environments
        },
      },
    ])
    .toArray();
}

// 2) Flaky detection: has this test BOTH passed and failed on the SAME
//    commitSha? Uses a $group by test + commitSha, per the contract.
//    NOTE: the run being diagnosed is INCLUDED ($lte) — the first failure on
//    a shared commit must see the earlier pass on that same commit, otherwise
//    the first flake would never be detected.
async function flakyCommitsForTest(collections, run, testName) {
  const docs = await collections.runs
    .aggregate([
      { $match: { projectId: run.projectId, startedAt: { $lte: run.startedAt } } },
      { $sort: { startedAt: -1 } },
      { $limit: HISTORY_RUNS },
      { $unwind: "$tests" },
      { $match: { "tests.name": testName, "tests.status": { $in: ["passed", "failed"] } } },
      { $group: { _id: { test: "$tests.name", commitSha: "$commitSha" }, statuses: { $addToSet: "$tests.status" } } },
      { $match: { statuses: { $all: ["passed", "failed"] } } },
    ])
    .toArray();
  return docs.map((d) => d._id.commitSha);
}

// 2b) All flaky tests in recent history (for the release check's "flaky tests
//     in the touched area" rule). Returns [{ name, file, commitSha }].
async function flakyTests(collections, run) {
  const docs = await collections.runs
    .aggregate([
      { $match: { projectId: run.projectId, startedAt: { $lte: run.startedAt } } },
      { $sort: { startedAt: -1 } },
      { $limit: HISTORY_RUNS },
      { $unwind: "$tests" },
      { $match: { "tests.status": { $in: ["passed", "failed"] } } },
      {
        $group: {
          _id: { test: "$tests.name", file: "$tests.file", commitSha: "$commitSha" },
          statuses: { $addToSet: "$tests.status" },
        },
      },
      { $match: { statuses: { $all: ["passed", "failed"] } } },
    ])
    .toArray();
  // Deduplicate by test name — one flaky commit as evidence is enough.
  const byName = new Map();
  for (const d of docs) {
    if (!byName.has(d._id.test)) {
      byName.set(d._id.test, { name: d._id.test, file: d._id.file, commitSha: d._id.commitSha });
    }
  }
  return [...byName.values()];
}

// 3) File risk: unwind changedFiles across history, group by file, and get
//    { runs, failures, failRate } per file — attached for the changed files
//    of the run being analyzed.
async function fileRiskRates(collections, run, files) {
  if (!Array.isArray(files) || files.length === 0) return {};
  const docs = await collections.runs
    .aggregate([
      { $match: { projectId: run.projectId, startedAt: { $lt: run.startedAt } } },
      { $unwind: "$changedFiles" },
      { $match: { changedFiles: { $in: files } } },
      {
        $group: {
          _id: "$changedFiles",
          runs: { $sum: 1 },
          failures: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          file: "$_id",
          runs: 1,
          failures: 1,
          failRate: { $divide: ["$failures", "$runs"] },
        },
      },
    ])
    .toArray();
  const out = {};
  for (const d of docs) {
    out[d.file] = { runs: d.runs, failures: d.failures, failRate: Math.round(d.failRate * 1000) / 1000 };
  }
  return out;
}

module.exports = { testHistory, flakyCommitsForTest, flakyTests, fileRiskRates, HISTORY_RUNS };
