// buildEvidence(runId) — combines the four analysis answers into ONE small
// JSON object containing ONLY verified facts. This object is what the LLM is
// allowed to see (no raw logs, no secrets — env var NAMES only ever), and it
// is also the yardstick the safety check measures the LLM output against.

const { getRun } = require("./history");
const { diagnoseRun } = require("./diagnose");
const { buildChanges } = require("./changes");
const { rankCulprits } = require("./culprits");
const { buildReleaseCheck } = require("./releaseCheck");

async function buildEvidence(collections, runId) {
  const run = await getRun(collections, runId);
  if (!run) return null;

  const [diagnosis, changes, culprits, release] = await Promise.all([
    diagnoseRun(collections, runId),
    buildChanges(collections, runId),
    rankCulprits(collections, runId),
    buildReleaseCheck(collections, run.projectId, runId),
  ]);

  const tests = run.tests || [];
  const top = (culprits.body.candidates || [])[0] || null;

  return {
    runId: run._id,
    projectId: run.projectId,
    status: run.status,
    branch: run.branch,
    commitSha: run.commitSha,
    startedAt: run.startedAt,
    tests: {
      total: tests.length,
      failed: tests.filter((t) => t.status === "failed").length,
      passed: tests.filter((t) => t.status === "passed").length,
    },
    // per failed test: verdict + confidence + "seen before" facts only
    failedTests: (diagnosis.body.tests || []).map((t) => ({
      name: t.name,
      file: t.file,
      verdict: t.verdict,
      confidence: t.confidence,
      seenBefore: {
        count: t.evidence.seenBefore.count,
        lastSeenRunId: t.evidence.seenBefore.lastSeenRunId,
        fixedByRunId: t.evidence.seenBefore.fixedBy ? t.evidence.seenBefore.fixedBy.runId : null,
        fixedByFiles: t.evidence.seenBefore.fixedBy ? t.evidence.seenBefore.fixedBy.files : [],
      },
    })),
    changedFiles: run.changedFiles || [],
    // suspect commits between the last good run and this one (capped)
    suspectCommits: (changes.body.commits || []).slice(0, 5).map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      files: c.files,
    })),
    baseline: changes.body.againstRunId
      ? { runId: changes.body.againstRunId, commitSha: changes.body.evidence.fromCommit }
      : null,
    dependencies: changes.body.dependencies,
    envChanges: changes.body.config,
    topCulprit: top
      ? {
          sha: top.sha,
          message: top.message,
          author: top.author,
          matchPercent: top.matchPercent,
          reasons: (top.reasons || []).slice(0, 2),
        }
      : null,
    culpritsConfidence: culprits.body.confidence,
    culpritsNote: culprits.body.note || null,
    release: {
      score: release.body.score,
      level: release.body.level,
      blocked: release.body.blocked,
      reasons: (release.body.reasons || []).map((r) => ({ points: r.points, text: r.text })),
      recommendation: release.body.recommendation,
    },
  };
}

module.exports = { buildEvidence };
