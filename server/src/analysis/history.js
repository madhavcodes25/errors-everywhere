// Shared data-access helpers for the analysis modules: fetch a run, the runs
// before it, the last good run, and the commits between two runs.

// How much history any analysis will look at. More than enough for a demo,
// small enough that every query stays fast on a free-tier cluster.
const MAX_HISTORY = 50;

async function getRun(collections, runId) {
  if (typeof runId !== "string" || !runId) return null;
  return collections.runs.findOne({ _id: runId });
}

// Earlier runs of the same project+branch, newest first, excluding the run
// itself. Same branch matters: comparing against a feature branch's history
// would blame the wrong commits.
async function listRunsBefore(collections, run, limit = MAX_HISTORY) {
  return collections.runs
    .find({
      projectId: run.projectId,
      branch: run.branch,
      _id: { $ne: run._id },
      startedAt: { $lt: run.startedAt },
    })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
}

// The most recent passing run before `run` — the "when it last worked" anchor.
function findLastGoodRun(runsBefore) {
  return runsBefore.find((r) => r.status === "passed") || null;
}

// Every commit recorded in runs AFTER the baseline run and UP TO AND INCLUDING
// the target run, deduped by sha, in chronological order. Also returns which
// runs contributed them — that is the evidence trail.
async function collectCommitsBetween(collections, baselineRun, run) {
  const docs = await collections.runs
    .find({
      projectId: run.projectId,
      branch: run.branch,
      startedAt: { $gt: baselineRun.startedAt, $lte: run.startedAt },
    })
    .sort({ startedAt: 1 })
    .toArray();

  const bySha = new Map();
  const fromRuns = [];
  for (const doc of docs) {
    let contributed = false;
    for (const commit of doc.commits || []) {
      if (!bySha.has(commit.sha)) {
        bySha.set(commit.sha, commit);
        contributed = true;
      }
    }
    if (contributed) fromRuns.push(doc._id);
  }
  return { commits: [...bySha.values()], fromRuns, contributingRunCount: docs.length };
}

module.exports = { getRun, listRunsBefore, findLastGoodRun, collectCommitsBetween, MAX_HISTORY };
