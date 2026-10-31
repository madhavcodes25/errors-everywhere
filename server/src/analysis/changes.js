// Changes — answers "what changed since it last worked?"
// Diffs a run against the last good run (or ?against=<runId>), returning
// structured sections: commits, files, dependencies, config, tests, duration.

const { getRun, collectCommitsBetween } = require("./history");
const { confidenceFromRunCount } = require("../lib/confidence");

// "^5.1.0" / "5.1.0" / "~4.17.2" -> 5 / 5 / 4 ; null when unparseable.
function majorOf(version) {
  const match = String(version ?? "").match(/(\d+)(?:\.\d+)?/);
  return match ? Number(match[1]) : null;
}

// Compare two dependency arrays -> { added, removed, changed }.
// `major: true` flags a MAJOR version increase (e.g. 4.x -> 5.x) — the kind
// of upgrade most likely to break things.
function diffDependencies(before = [], after = []) {
  const beforeMap = new Map(before.map((d) => [d.name, d.version]));
  const afterMap = new Map(after.map((d) => [d.name, d.version]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [name, version] of afterMap) {
    if (!beforeMap.has(name)) {
      added.push({ name, version });
    } else if (beforeMap.get(name) !== version) {
      const from = beforeMap.get(name);
      const fromMajor = majorOf(from);
      const toMajor = majorOf(version);
      changed.push({
        name,
        from,
        to: version,
        major: fromMajor !== null && toMajor !== null && toMajor > fromMajor,
      });
    }
  }
  for (const [name, version] of beforeMap) {
    if (!afterMap.has(name)) removed.push({ name, version });
  }
  return { added, removed, changed };
}

// Compare two string arrays -> { added, removed }.
function diffSets(before = [], after = []) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((x) => !beforeSet.has(x)),
    removed: before.filter((x) => !afterSet.has(x)),
  };
}

// Which tests changed outcome between two runs (matched by name), plus tests
// that became MUCH slower (> 2x their previous duration).
function diffTests(before = [], after = []) {
  const beforeMap = new Map(before.map((t) => [t.name, t]));
  const newlyFailing = [];
  const newlyPassing = [];
  const stillFailing = [];
  const muchSlower = [];
  for (const test of after) {
    const prev = beforeMap.get(test.name);
    const was = prev && prev.status;
    if (test.status === "failed" && was !== "failed") newlyFailing.push(test.name);
    else if (test.status !== "failed" && was === "failed") newlyPassing.push(test.name);
    else if (test.status === "failed" && was === "failed") stillFailing.push(test.name);
    if (prev && prev.durationMs > 0 && test.durationMs > 2 * prev.durationMs) {
      muchSlower.push({ name: test.name, previousMs: prev.durationMs, currentMs: test.durationMs });
    }
  }
  return { newlyFailing, newlyPassing, stillFailing, muchSlower };
}

// HTTP-facing: build the changes answer for a run.
async function buildChanges(collections, runId, againstParam) {
  const run = await getRun(collections, runId);
  if (!run) return { code: 404, body: { error: `run not found: ${runId}` } };

  let against = null;
  let againstIsLastGood = false;

  if (againstParam) {
    against = await getRun(collections, againstParam);
    if (!against) return { code: 404, body: { error: `against run not found: ${againstParam}` } };
    if (against.projectId !== run.projectId) {
      return {
        code: 400,
        body: { error: `against run belongs to project ${against.projectId}, not ${run.projectId}` },
      };
    }
  } else {
    // Last good run (status passed, before this run) — the
    // {projectId, status, startedAt} index serves this query directly.
    against = await collections.runs.findOne(
      { projectId: run.projectId, status: "passed", startedAt: { $lt: run.startedAt } },
      { sort: { startedAt: -1 } }
    );
    againstIsLastGood = Boolean(against);
  }

  const priorRunCount = await collections.runs.countDocuments({
    projectId: run.projectId,
    startedAt: { $lt: run.startedAt },
  });

  // No baseline: return a clear message with the run's own data, no error.
  if (!against) {
    return {
      code: 200,
      body: {
        runId: run._id,
        projectId: run.projectId,
        status: run.status,
        againstRunId: null,
        againstIsLastGood: false,
        note: "No earlier passing run exists for this project — showing only this run's own data, nothing to diff against.",
        commits: run.commits || [],
        changedFiles: run.changedFiles || [],
        dependencies: { added: run.dependencies || [], removed: [], changed: [] },
        config: {
          envKeys: { appeared: run.envKeys || [], disappeared: [] },
          missingEnvKeys: { introduced: run.missingEnvKeys || [], resolved: [] },
        },
        tests: { newlyFailing: [], newlyPassing: [], stillFailing: [], muchSlower: [] },
        duration: { previousMs: null, currentMs: run.durationMs, deltaMs: null },
        evidence: { runIds: [run._id], fromCommit: null, toCommit: run.commitSha },
        confidence: "low",
      },
    };
  }

  const { commits, fromRuns } = await collectCommitsBetween(collections, against, run);

  return {
    code: 200,
    body: {
      runId: run._id,
      projectId: run.projectId,
      status: run.status,
      againstRunId: against._id,
      againstIsLastGood,
      commits,
      changedFiles: [...new Set(commits.flatMap((c) => c.files || []))],
      dependencies: diffDependencies(against.dependencies || [], run.dependencies || []),
      config: {
        envKeys: diffSets(against.envKeys || [], run.envKeys || []),
        missingEnvKeys: {
          introduced: (run.missingEnvKeys || []).filter((k) => !(against.missingEnvKeys || []).includes(k)),
          resolved: (against.missingEnvKeys || []).filter((k) => !(run.missingEnvKeys || []).includes(k)),
        },
      },
      tests: diffTests(against.tests || [], run.tests || []),
      duration: {
        previousMs: against.durationMs,
        currentMs: run.durationMs,
        deltaMs: run.durationMs - against.durationMs,
      },
      evidence: {
        runIds: [against._id, run._id],
        fromCommit: against.commitSha,
        toCommit: run.commitSha,
        commitsCarriedByRuns: fromRuns,
      },
      confidence: confidenceFromRunCount(priorRunCount),
    },
  };
}

module.exports = { buildChanges, diffDependencies, diffSets, diffTests, majorOf };
