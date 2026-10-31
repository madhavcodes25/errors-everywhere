// Release check — "is it safe to release today?"
//
// Explainable POINTS-BASED score: start at 0, add points per risk rule.
// Every reason names its real evidence (test names, file names, run IDs).
// The rules live in the RULES config object below — tune points there.
//
//   latest run failed ................ +50 (blocked: true)
//   each currently failing test ...... +10 (max +30)
//   each changed file with failRate > 0.4 ... +15 (max +30)
//   major dependency upgrade ......... +15
//   missing/changed required env var . +20
//   more than 10 files changed ....... +10
//   2+ failures in last 5 runs ....... +10
//   flaky tests in the touched area .. +5
//   level: >=60 HIGH, >=30 MEDIUM, else LOW.

const { getRun } = require("./history");
const { diffDependencies, diffSets } = require("./changes");
const { fileRiskRates, flakyTests } = require("./aggregations");
const { rankCulprits } = require("./culprits");
const { sourceFilesForTestFile } = require("../lib/testMap");
const { confidenceFromRunCount } = require("../lib/confidence");

// --- Tunable rules ---------------------------------------------------------
const RULES = {
  latestRunFailed: { points: 50, blocked: true },
  failingTest: { points: 10, max: 30 }, // per currently failing test
  highSuspicionCommit: { points: 10, threshold: 60 }, // top culprit matchPercent > 60 on a failed run
  riskyFile: { points: 15, max: 30, failRateThreshold: 0.4 }, // per changed file with high historical failure rate
  majorDependencyUpgrade: { points: 15 }, // per dependency major bump vs the last good run
  missingOrChangedEnvVar: { points: 20 }, // missingEnvKeys, or env vars changed vs the last good run
  manyFilesChanged: { points: 10, threshold: 10 }, // more than N changed files in the latest run
  recentFailures: { points: 10, minFailures: 2, window: 5 }, // 2+ failed runs among the last 5
  flakyTouchedArea: { points: 5 }, // a flaky test exercises files this run touched
};

// Score thresholds for the level label.
const LEVELS = { HIGH: 60, MEDIUM: 30 };

// PURE. Score a run from pre-fetched context and return JSON.
// ctx: { risk, depDiff, envDiff, lastFive, flakyInArea }
function scoreRelease(run, ctx) {
  const reasons = [];
  let score = 0;
  let blocked = false;

  const failingTests = (run.tests || []).filter((t) => t.status === "failed");

  // Rule: latest run failed.
  if (run.status !== "passed") {
    score += RULES.latestRunFailed.points;
    blocked = RULES.latestRunFailed.blocked;
    reasons.push({
      text: `Latest run ${run._id} did not pass (status "${run.status}", commit ${String(run.commitSha).slice(0, 7)})`,
      points: RULES.latestRunFailed.points,
    });
  }

  // Rule: each currently failing test (capped).
  if (failingTests.length > 0) {
    const points = Math.min(RULES.failingTest.points * failingTests.length, RULES.failingTest.max);
    score += points;
    reasons.push({
      text: `${failingTests.length} test(s) currently failing: ${failingTests.map((t) => `"${t.name}"`).join(", ")}`,
      points,
    });
  }

  // Rule: an unfixed high-suspicion commit (top culprit from the ranking).
  const top = ctx.culprit;
  if (top && top.matchPercent > RULES.highSuspicionCommit.threshold) {
    score += RULES.highSuspicionCommit.points;
    reasons.push({
      text: `Unfixed high-suspicion commit: ${String(top.sha).slice(0, 7)} "${top.message}" (${top.matchPercent}% match)`,
      points: RULES.highSuspicionCommit.points,
    });
  }

  // Rule: changed files with a historically high failure rate (capped).
  const risky = Object.entries(ctx.risk || {}).filter(([, r]) => r.failRate > RULES.riskyFile.failRateThreshold);
  if (risky.length > 0) {
    const points = Math.min(RULES.riskyFile.points * risky.length, RULES.riskyFile.max);
    score += points;
    reasons.push({
      text: `High-risk changed file(s): ${risky
        .map(([file, r]) => `${file} (${Math.round(r.failRate * 100)}% failure rate over ${r.runs} runs)`)
        .join(", ")}`,
      points,
    });
  }

  // Rule: major dependency upgrade(s) since the last good run.
  const majors = ((ctx.depDiff && ctx.depDiff.changed) || []).filter((d) => d.major);
  if (majors.length > 0) {
    const points = RULES.majorDependencyUpgrade.points * majors.length;
    score += points;
    reasons.push({
      text: `Major dependency upgrade(s): ${majors.map((m) => `${m.name} ${m.from} -> ${m.to}`).join(", ")}`,
      points,
    });
  }

  // Rule: missing / changed required env vars.
  const missing = run.missingEnvKeys || [];
  const envChanged = ctx.envDiff && (ctx.envDiff.added.length > 0 || ctx.envDiff.removed.length > 0);
  if (missing.length > 0 || envChanged) {
    score += RULES.missingOrChangedEnvVar.points;
    const what =
      missing.length > 0
        ? `missing required env var(s): ${missing.join(", ")}`
        : `env vars changed since the last good run (appeared: ${ctx.envDiff.added.join(", ") || "none"}; disappeared: ${ctx.envDiff.removed.join(", ") || "none"})`;
    reasons.push({ text: `Environment problem: ${what}`, points: RULES.missingOrChangedEnvVar.points });
  }

  // Rule: many files changed at once.
  const fileCount = (run.changedFiles || []).length;
  if (fileCount > RULES.manyFilesChanged.threshold) {
    score += RULES.manyFilesChanged.points;
    reasons.push({
      text: `${fileCount} files changed in one run (more than ${RULES.manyFilesChanged.threshold}) — hard to attribute failures`,
      points: RULES.manyFilesChanged.points,
    });
  }

  // Rule: repeated failures in the recent window.
  const recentFailures = (ctx.lastFive || []).filter((r) => r.status === "failed");
  if (recentFailures.length >= RULES.recentFailures.minFailures) {
    score += RULES.recentFailures.points;
    reasons.push({
      text: `${recentFailures.length} failed runs in the last ${ctx.lastFive.length} (evidence: ${recentFailures.map((r) => r._id).join(", ")})`,
      points: RULES.recentFailures.points,
    });
  }

  // Rule: flaky tests in the files this run touched.
  if (ctx.flakyInArea && ctx.flakyInArea.length > 0) {
    score += RULES.flakyTouchedArea.points;
    reasons.push({
      text: `Flaky test(s) in the touched area: ${ctx.flakyInArea
        .map((f) => `"${f.name}" (${f.file}, flaky on commit ${String(f.commitSha).slice(0, 7)})`)
        .join(", ")}`,
      points: RULES.flakyTouchedArea.points,
    });
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= LEVELS.HIGH ? "HIGH" : score >= LEVELS.MEDIUM ? "MEDIUM" : "LOW";
  const topIssue = reasons.length > 0 ? reasons[0].text : "none";
  const recommendation = blocked
    ? `Do not release yet. Top issue: ${topIssue}. Fix it, land a green run, then re-check.`
    : score >= LEVELS.MEDIUM
      ? `Risky release (score ${score}/100). Review the reason(s) above before shipping.`
      : `No build-health risks found (score ${score}/100). Safe to release from TraceBack's point of view.`;

  return { score, level, blocked, reasons, recommendation };
}

// HTTP-facing wrapper. Defaults to the project's latest run; ?runId overrides.
async function buildReleaseCheck(collections, projectId, runId) {
  let latestRun;
  if (runId) {
    latestRun = await getRun(collections, runId);
    if (!latestRun) return { code: 404, body: { error: `run not found: ${runId}` } };
    if (latestRun.projectId !== projectId) {
      return {
        code: 400,
        body: { error: `run ${runId} belongs to project ${latestRun.projectId}, not ${projectId}` },
      };
    }
  } else {
    latestRun = await collections.runs.findOne({ projectId }, { sort: { startedAt: -1 } });
    if (!latestRun) return { code: 404, body: { error: `no runs recorded for project ${projectId}` } };
  }

  const priorRunCount = await collections.runs.countDocuments({
    projectId,
    startedAt: { $lt: latestRun.startedAt },
  });

  // Evidence gathering (all project-scoped, served by the new indexes):
  // last good run for dep/env diffs, last 5 runs for the recent-failures
  // rule, file risk rates for this run's changed files, flaky tests.
  const lastGood = await collections.runs.findOne(
    { projectId, status: "passed", startedAt: { $lt: latestRun.startedAt } },
    { sort: { startedAt: -1 } }
  );
  const lastFive = await collections.runs
    .find({ projectId, startedAt: { $lte: latestRun.startedAt } })
    .sort({ startedAt: -1 })
    .limit(RULES.recentFailures.window)
    .toArray();
  const risk = await fileRiskRates(collections, latestRun, latestRun.changedFiles || []);
  const depDiff = lastGood ? diffDependencies(lastGood.dependencies || [], latestRun.dependencies || []) : null;
  const envDiff = lastGood ? diffSets(lastGood.envKeys || [], latestRun.envKeys || []) : null;

  const touched = new Set(latestRun.changedFiles || []);
  const allFlaky = await flakyTests(collections, latestRun);
  const flakyInArea = allFlaky.filter(
    (f) => touched.has(f.file) || sourceFilesForTestFile(f.file).some((src) => touched.has(src))
  );

  // Top culprit for the "unfixed high-suspicion commit" rule (failed runs only).
  let culprit = null;
  if (latestRun.status !== "passed") {
    const culprits = await rankCulprits(collections, latestRun._id);
    culprit = culprits.body.candidates[0] || null;
  }

  const { score, level, blocked, reasons, recommendation } = scoreRelease(latestRun, {
    risk,
    depDiff,
    envDiff,
    lastFive,
    flakyInArea,
    culprit,
  });

  return {
    code: 200,
    body: {
      projectId,
      runId: latestRun._id,
      branch: latestRun.branch,
      asOf: new Date().toISOString(),
      score,
      level,
      blocked,
      reasons,
      recommendation,
      confidence: confidenceFromRunCount(priorRunCount),
    },
  };
}

module.exports = { buildReleaseCheck, scoreRelease, RULES, LEVELS };
