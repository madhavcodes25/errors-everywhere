// Diagnosis — answers "why did this run fail?" PER TEST.
//
// Structure: pure classification logic (classifyTest, knownFix) takes data
// and returns JSON — easy to unit test. diagnoseRun() gathers the data via
// the aggregation pipelines in aggregations.js and assembles the response.
//
// Classification rules, applied IN ORDER (first match wins):
//   flaky               — the same test has both passed and failed on the
//                         SAME commitSha somewhere in (recent) history
//   environment_problem — the run has missingEnvKeys, OR a dependency changed
//                         AND 3+ tests failed with the same error signature
//   new_regression      — passed in the immediately previous run, fails now
//   long_standing_break — failing in the last N consecutive runs
//   unknown             — honest fallback

const { getRun } = require("./history");
const { testHistory, flakyCommitsForTest, fileRiskRates, HISTORY_RUNS } = require("./aggregations");
const { diffDependencies } = require("./changes");
const { rankCulprits } = require("./culprits");
const { confidenceFromRunCount } = require("../lib/confidence");

const CONSECUTIVE_FAILS = 3; // "failing in the last N consecutive runs"
const SIGNATURE_CLUSTER = 3; // "3+ tests failed with the same error signature"

// PURE. Classify one failed test from its history and run context.
//   history          — newest-first entries { runId, commitSha, status, ... }
//   flakyCommitShas  — commits where this test had both outcomes (may include
//                      the run being diagnosed; see aggregations.js)
//   runEnvKeys       — the CURRENT run's env var names (for the flaky check)
function classifyTest({ test, history, flakyCommitShas, runEnvKeys, runMissingEnvKeys, dependencyChanged, maxSignatureCluster }) {
  const name = test.name;

  // Rule 1: flaky — pass AND fail on the same commit IN THE SAME ENVIRONMENT.
  // (Part 8 refinement: if the environments differed between the outcomes on
  // a shared commit, the env change explains the difference — that is rule
  // 2a, not flakiness. "Flaky" means same commit, same conditions.)
  const flakyCommitsWithSameEnv = (flakyCommitShas || []).filter((sha) => {
    const envSignatures = new Set([JSON.stringify([...(runEnvKeys || [])].sort())]);
    for (const h of history) {
      if (h.commitSha === sha) envSignatures.add(JSON.stringify([...(h.envKeys || [])].sort()));
    }
    return envSignatures.size <= 1;
  });
  if (flakyCommitsWithSameEnv.length > 0) {
    return {
      verdict: "flaky",
      explanation: `"${name}" has both passed and failed on commit ${String(flakyCommitsWithSameEnv[0]).slice(0, 7)} under the same environment — a flaky test, not a code regression.`,
    };
  }

  // Rule 2a: environment problem — required env vars are missing right now.
  if (runMissingEnvKeys && runMissingEnvKeys.length > 0) {
    return {
      verdict: "environment_problem",
      explanation: `"${name}" failed while required environment variable(s) were missing: ${runMissingEnvKeys.join(", ")}. Fix the environment before looking at the code.`,
    };
  }

  // Rule 2b: environment problem — dependencies changed AND 3+ tests failed
  // with the same error signature (a broken upgrade, not N separate bugs).
  if (dependencyChanged && maxSignatureCluster >= SIGNATURE_CLUSTER) {
    return {
      verdict: "environment_problem",
      explanation: `Dependencies changed and ${maxSignatureCluster} tests failed with the same error signature — likely a dependency or environment problem.`,
    };
  }

  // Rule 3: new regression — passed in the immediately previous run.
  const newest = history[0];
  if (newest && newest.status === "passed") {
    return {
      verdict: "new_regression",
      explanation: `"${name}" passed in the previous run (${newest.runId}) and fails now — something in between broke it.`,
    };
  }

  // Rule 4: long-standing break — failing in the last N consecutive runs.
  let streak = 0;
  while (streak < history.length && history[streak].status === "failed") streak += 1;
  if (streak >= CONSECUTIVE_FAILS) {
    const since = history[streak - 1]; // oldest run of the streak (newest-first array)
    return {
      verdict: "long_standing_break",
      explanation: `"${name}" has failed in the last ${streak} consecutive runs (since ${since.runId}).`,
    };
  }

  // Rule 5: honest fallback.
  return {
    verdict: "unknown",
    explanation: `"${name}" fails, but its history (${history.length} occurrence(s) in the last ${HISTORY_RUNS} runs) shows no clear pattern — inspect it manually.`,
  };
}

// PURE. "Known fix" evidence from the test's history: how many times the same
// error signature was seen before, and the first LATER passing run for the
// test (whose commits/files are reported as the fix). history is newest-first.
function knownFix(test, history) {
  const signature = test.error && test.error.signature;
  if (!signature) return null;
  const sameSignature = history.filter((h) => h.status === "failed" && h.error && h.error.signature === signature);
  if (sameSignature.length === 0) return null;

  const lastFailureIdx = history.indexOf(sameSignature[0]); // newest failure (filter kept order)
  const laterPass = history.slice(0, lastFailureIdx).find((h) => h.status === "passed");
  return {
    count: sameSignature.length,
    firstSeenRunId: sameSignature[sameSignature.length - 1].runId,
    lastSeenRunId: sameSignature[0].runId,
    fixedByRunId: laterPass ? laterPass.runId : null,
  };
}

// HTTP-facing wrapper: gather evidence, classify, assemble the response.
async function diagnoseRun(collections, runId) {
  const run = await getRun(collections, runId);
  if (!run) return { code: 404, body: { error: `run not found: ${runId}` } };

  const failedTests = (run.tests || []).filter((t) => t.status === "failed");

  // Run-level context for rule 2b: did a dependency change vs the baseline,
  // and how many failed tests share one error signature?
  const baseline =
    (await collections.runs.findOne(
      { projectId: run.projectId, startedAt: { $lt: run.startedAt }, _id: { $ne: run._id } },
      { sort: { startedAt: -1 } }
    )) || null;
  let dependencyChanged = false;
  if (baseline) {
    const depDiff = diffDependencies(baseline.dependencies || [], run.dependencies || []);
    dependencyChanged = depDiff.added.length + depDiff.removed.length + depDiff.changed.length > 0;
  }
  const signatureCounts = new Map();
  for (const test of failedTests) {
    const key = (test.error && test.error.signature) || `no-error:${test.name}`;
    signatureCounts.set(key, (signatureCounts.get(key) || 0) + 1);
  }
  const maxSignatureCluster = Math.max(0, ...signatureCounts.values());

  const priorRunCount = await collections.runs.countDocuments({
    projectId: run.projectId,
    startedAt: { $lt: run.startedAt },
  });
  const risk = failedTests.length > 0 ? await fileRiskRates(collections, run, run.changedFiles || []) : {};

  const tests = [];
  for (const test of failedTests) {
    const history = await testHistory(collections, run, test.name);
    const flakyCommitShas = await flakyCommitsForTest(collections, run, test.name);
    const { verdict, explanation } = classifyTest({
      test,
      history,
      flakyCommitShas,
      runEnvKeys: run.envKeys || [],
      runMissingEnvKeys: run.missingEnvKeys || [],
      dependencyChanged,
      maxSignatureCluster,
    });

    // "Known fix": same signature seen before + the first later passing run.
    const seen = knownFix(test, history);
    let fixedBy = null;
    if (seen && seen.fixedByRunId) {
      const fixRun = await getRun(collections, seen.fixedByRunId);
      if (fixRun) {
        fixedBy = {
          runId: fixRun._id,
          commits: (fixRun.commits || []).map((c) => ({ sha: c.sha, message: c.message })),
          files: fixRun.changedFiles || [],
        };
      }
    }
    let fullExplanation = explanation;
    if (seen && seen.count > 0) {
      fullExplanation += ` Seen ${seen.count} time(s) before`;
      fullExplanation += fixedBy
        ? `; the first later passing run (${fixedBy.runId}) contained commit(s) ${fixedBy.commits
            .map((c) => String(c.sha).slice(0, 7))
            .join(", ")} touching ${fixedBy.files.join(", ")}.`
        : " but no later passing run was found for this test.";
    }

    tests.push({
      name: test.name,
      file: test.file,
      verdict,
      confidence: confidenceFromRunCount(history.length), // per-test: its own history size
      explanation: fullExplanation,
      evidence: {
        history,
        fileRiskRates: risk,
        seenBefore: {
          count: seen ? seen.count : 0,
          lastSeenRunId: seen ? seen.lastSeenRunId : null,
          fixedBy,
        },
      },
    });
  }

  // Integration: when the culprit ranking is convincing (>50% of the
  // normalized evidence), surface the top culprit in the diagnosis note.
  let culpritNote = null;
  if (failedTests.length > 0) {
    const culprits = await rankCulprits(collections, run._id);
    const top = culprits.body.candidates[0];
    if (top && top.matchPercent > 50) {
      culpritNote = `Most likely culprit: ${String(top.sha).slice(0, 7)} "${top.message}" (${top.matchPercent}% of the evidence).`;
    }
  }

  let note;
  if (failedTests.length === 0) {
    note = run.status === "passed" ? "Run passed — nothing to diagnose." : "No failing tests were recorded for this run.";
  } else {
    note = culpritNote; // may be null when no commit stands out
  }

  return {
    code: 200,
    body: {
      runId: run._id,
      projectId: run.projectId,
      status: run.status,
      confidence: confidenceFromRunCount(priorRunCount), // top-level: project history
      tests,
      ...(note ? { note } : {}),
    },
  };
}

module.exports = { diagnoseRun, classifyTest, knownFix };
