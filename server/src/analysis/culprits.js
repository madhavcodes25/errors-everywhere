// Culprit ranking — "find the guilty commit without re-running anything."
//
// git bisect rebuilds and retests repeatedly; Errors Everywhere ranks suspect
// commits instantly from the history already stored in MongoDB.
//
// ALGORITHM (per the contract):
//   1. candidates = every commit in runs AFTER the last good run, up to and
//      including the failing run (covers multi-run failure streaks).
//   2. for each failed test T, learn per-file suspicion with a LIFT score
//      (ONE $facet aggregation over the last 30 earlier runs):
//        failGivenChanged(T,F) = runs where F changed AND T failed / runs where F changed
//        failOverall(T)        = runs where T failed / total runs
//        lift(T,F)             = (failGivenChanged + a) / (failOverall + a)
//      additive smoothing a = 0.05; files with < 2 past samples get lift = 1.
//   3. path-match bonus: a file matching the failing test's module
//      (src/payment.js <-> tests/payment.test.js) gets +1.0 — the fallback
//      that keeps short histories useful.
//   4. commit score = sum over its files, across all failed tests, of
//      max(0, lift - 1) + pathBonus. Files that never correlate (README.md)
//      naturally score 0.
//   5. scores are normalized to sum to 100%; when everything scores 0 the
//      candidates get equal percentages, confidence drops to "low" and a
//      message says so.

const { getRun, collectCommitsBetween } = require("./history");
const { sourceFilesForTestFile } = require("../lib/testMap");
const { confidenceFromRunCount } = require("../lib/confidence");
const { HISTORY_RUNS } = require("./aggregations");

const SMOOTHING = 0.05; // additive smoothing "a" — no division by zero, no overreaction
const MIN_FILE_SAMPLE = 2; // a file must have changed in >= 2 past runs to be judged
const PATH_BONUS = 1.0; // score added when file and failing test share a module name

// ONE aggregation ($facet) gathers every statistic the scorer needs, served
// by the {projectId, startedAt} index. No per-file query loops.
async function liftStats(collections, run) {
  const [raw] = await collections.runs
    .aggregate([
      { $match: { projectId: run.projectId, startedAt: { $lt: run.startedAt } } },
      { $sort: { startedAt: -1 } },
      { $limit: HISTORY_RUNS },
      {
        $project: {
          changedFiles: 1,
          failedTestNames: {
            $map: {
              input: { $filter: { input: "$tests", as: "t", cond: { $eq: ["$$t.status", "failed"] } } },
              as: "t",
              in: "$$t.name",
            },
          },
        },
      },
      {
        $facet: {
          // total earlier runs in the window (denominator of failOverall)
          totals: [{ $count: "n" }],
          // per failed test: how many of those runs it failed in
          testStats: [
            { $unwind: "$failedTestNames" },
            { $group: { _id: "$failedTestNames", fails: { $sum: 1 }, runIds: { $addToSet: "$_id" } } },
          ],
          // per file: how many of those runs changed it
          fileStats: [
            { $unwind: "$changedFiles" },
            { $group: { _id: "$changedFiles", changed: { $sum: 1 }, runIds: { $addToSet: "$_id" } } },
          ],
          // per (test, file) pair: runs where the file changed AND the test failed
          coStats: [
            { $unwind: "$changedFiles" },
            { $unwind: "$failedTestNames" },
            { $group: { _id: { file: "$changedFiles", test: "$failedTestNames" }, co: { $sum: 1 }, runIds: { $addToSet: "$_id" } } },
          ],
        },
      },
    ])
    .toArray();

  const safe = raw || { totals: [], testStats: [], fileStats: [], coStats: [] };
  const stats = {
    totalRuns: (safe.totals[0] || { n: 0 }).n,
    testStats: {},
    fileStats: {},
    coStats: {},
  };
  for (const d of safe.testStats) stats.testStats[d._id] = { fails: d.fails, runIds: d.runIds };
  for (const d of safe.fileStats) stats.fileStats[d._id] = { changed: d.changed, runIds: d.runIds };
  for (const d of safe.coStats) {
    if (!stats.coStats[d._id.test]) stats.coStats[d._id.test] = {};
    stats.coStats[d._id.test][d._id.file] = { co: d.co, runIds: d.runIds };
  }
  return stats;
}

// PURE. Score candidates from pre-fetched history statistics.
// stats shape (also used by the jest unit test):
//   { totalRuns,
//     testStats: { [testName]: { fails, runIds } },
//     fileStats: { [file]: { changed, runIds } },
//     coStats:   { [testName]: { [file]: { co, runIds } } } }
// Returns { candidates (ranked), allZero }.
function scoreCandidates(commits, failedTests, stats) {
  // lift(T, F) with additive smoothing; neutral (1) for tiny samples.
  const liftFor = (testName, file) => {
    const fileStat = stats.fileStats[file];
    const changed = fileStat ? fileStat.changed : 0;
    const fileRunIds = fileStat ? fileStat.runIds : [];
    if (changed < MIN_FILE_SAMPLE) {
      return { lift: 1, co: 0, changed, runIds: fileRunIds, sampled: false };
    }
    const coStat = (stats.coStats[testName] || {})[file];
    const co = coStat ? coStat.co : 0;
    const fails = (stats.testStats[testName] || { fails: 0 }).fails;
    const failOverall = fails / Math.max(1, stats.totalRuns);
    const failGivenChanged = co / changed;
    return {
      lift: (failGivenChanged + SMOOTHING) / (failOverall + SMOOTHING),
      co,
      changed,
      runIds: coStat ? coStat.runIds : fileRunIds,
      sampled: true,
    };
  };

  // Path-match bonus: the file IS the test's file, or the module it tests.
  const pathBonusFor = (test, file) =>
    file === test.file || sourceFilesForTestFile(test.file).includes(file) ? PATH_BONUS : 0;

  const scored = commits.map((commit, index) => {
    let score = 0;
    const reasons = [];
    const evidence = new Set();
    for (const test of failedTests) {
      for (const file of commit.files || []) {
        const { lift, co, changed, runIds } = liftFor(test.name, file);
        const contribution = Math.max(0, lift - 1);
        const bonus = pathBonusFor(test, file);

        if (contribution > 0) {
          score += contribution;
          if (co > 0) {
            reasons.push(`${file} changes preceded "${test.name}" failures in ${co} of ${changed} past runs`);
            for (const id of runIds) evidence.add(String(id));
          }
        }
        if (bonus > 0) {
          score += bonus;
          reasons.push(`${file} matches the failing test's module (${test.file})`);
          for (const id of runIds.slice(0, 5)) evidence.add(String(id));
        }
      }
    }
    return { commit, index, score, reasons: reasons.slice(0, 4), evidence: [...evidence].slice(0, 10) };
  });

  // Normalize to percentages that sum to ~100 (all-zero -> equal shares).
  const totalScore = scored.reduce((sum, c) => sum + c.score, 0);
  const allZero = scored.length > 0 && totalScore === 0;
  const sorted = [...scored].sort((a, b) => b.score - a.score || b.index - a.index); // ties: most recent wins
  const withPct = sorted.map((c) => ({
    ...c,
    matchPercent: allZero
      ? Math.round((100 / sorted.length) * 10) / 10
      : Math.round((c.score / totalScore) * 1000) / 10,
  }));
  if (!allZero && withPct.length > 0) {
    // rounding drift fix: push the remainder onto rank 1 (already sorted)
    const sum = withPct.reduce((s, c) => s + c.matchPercent, 0);
    const drift = Math.round((100 - sum) * 10) / 10;
    if (drift !== 0) {
      withPct[0].matchPercent = Math.round((withPct[0].matchPercent + drift) * 10) / 10;
    }
  }

  const candidates = withPct.map((c, i) => ({
    rank: i + 1,
    sha: c.commit.sha,
    message: c.commit.message,
    author: c.commit.author,
    files: c.commit.files || [],
    matchPercent: c.matchPercent,
    reasons: c.reasons,
    evidenceRunIds: c.evidence,
  }));
  return { candidates, allZero };
}

// HTTP-facing wrapper. Routes just call this.
async function rankCulprits(collections, runId) {
  const run = await getRun(collections, runId);
  if (!run) return { code: 404, body: { error: `run not found: ${runId}` } };

  const priorRunCount = await collections.runs.countDocuments({
    projectId: run.projectId,
    startedAt: { $lt: run.startedAt },
  });
  const confidence = confidenceFromRunCount(priorRunCount);

  // A passing run has nothing to blame — say so plainly.
  if (run.status === "passed") {
    return {
      code: 200,
      body: { runId, status: run.status, confidence, baselineRunId: null, candidates: [], note: "This run passed — there is nothing to blame." },
    };
  }
  const failedTests = (run.tests || []).filter((t) => t.status === "failed");
  if (failedTests.length === 0) {
    return {
      code: 200,
      body: { runId, status: run.status, confidence, baselineRunId: null, candidates: [], note: "No failing tests were recorded — nothing to attribute." },
    };
  }

  // Step 1: baseline + candidate commits (covers multi-run failure streaks).
  const lastGood = await collections.runs.findOne(
    { projectId: run.projectId, status: "passed", startedAt: { $lt: run.startedAt } },
    { sort: { startedAt: -1 } }
  );
  let commits;
  let fromRuns;
  if (lastGood) {
    ({ commits, fromRuns } = await collectCommitsBetween(collections, lastGood, run));
  } else {
    commits = run.commits || []; // no baseline: this run's own commits, clearly labelled
    fromRuns = [run._id];
  }

  const stats = await liftStats(collections, run);
  const { candidates, allZero } = scoreCandidates(commits, failedTests, stats);

  const notes = [];
  if (!lastGood) notes.push("No earlier passing run exists — candidates are this run's own commits.");
  if (commits.length === 0) notes.push("No commits were recorded between the last good run and this failure.");
  if (allZero) {
    notes.push("No commit stood out from history — equal (low) percentages shown; investigate manually.");
  }
  const effectiveConfidence = allZero ? "low" : confidence;
  if (effectiveConfidence === "low") {
    notes.push("Limited history, ranking relies mostly on file/test name matching.");
  }

  return {
    code: 200,
    body: {
      runId,
      status: run.status,
      confidence: effectiveConfidence,
      baselineRunId: lastGood ? lastGood._id : null,
      candidates,
      note: notes.length > 0 ? notes.join(" ") : null,
    },
  };
}

module.exports = { rankCulprits, scoreCandidates, liftStats, SMOOTHING, MIN_FILE_SAMPLE, PATH_BONUS };
