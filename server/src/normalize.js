// Turns a validated event body into a normalized run document.
// The analysis layer only ever reads `runs`; `events` stays the raw audit trail.

const { redactText } = require("./lib/redact");
const { errorSignature } = require("./lib/signature");

// runId = "run_" + first 12 chars of eventId (per the data contract).
function runIdFromEventId(eventId) {
  return "run_" + String(eventId).slice(0, 12);
}

// Always store file paths with forward slashes so comparisons work everywhere
// (collectors may run on Windows).
function normalizePath(p) {
  return String(p ?? "").replace(/\\/g, "/");
}

// envKeys must be NAMES ONLY. If someone sends an object {NAME: value} we keep
// the keys and silently drop the values — values must never be stored.
function extractEnvKeys(envKeys) {
  if (Array.isArray(envKeys)) return envKeys.map((k) => String(k)).filter(Boolean);
  if (envKeys && typeof envKeys === "object") return Object.keys(envKeys).map(String);
  return [];
}

// Dependencies are an ARRAY of {name, version} per the contract. (A plain
// object would use package names as field paths, and dots in scoped package
// names like "@scope/pkg" break MongoDB paths.) Accept a map, but convert it.
function normalizeDependencies(dependencies) {
  if (Array.isArray(dependencies)) {
    return dependencies
      .filter((d) => d && d.name)
      .map((d) => ({ name: String(d.name), version: String(d.version ?? "unknown") }));
  }
  if (dependencies && typeof dependencies === "object") {
    return Object.entries(dependencies).map(([name, version]) => ({
      name: String(name),
      version: String(version),
    }));
  }
  return [];
}

// Jest reports "pending"/"todo"; the contract enum is passed|failed|skipped.
function mapTestStatus(status) {
  if (status === "passed" || status === "failed") return status;
  if (status === "pending" || status === "todo" || status === "skipped") return "skipped";
  return "skipped"; // unknown statuses never masquerade as passes
}

// Trust the collector's status when given; otherwise derive it.
function normalizeStatus(status, tests, collectorError) {
  if (status === "errored" || status === "failed" || status === "passed") return status;
  if (collectorError) return "errored"; // the run never really executed
  if (tests.some((t) => t.status === "failed")) return "failed";
  return "passed";
}

function normalizeCommits(commits) {
  if (!Array.isArray(commits)) return [];
  return commits
    .filter((c) => c && c.sha)
    .map((c) => ({
      sha: String(c.sha),
      message: redactText(String(c.message ?? "")),
      author: String(c.author ?? "unknown"),
      files: (Array.isArray(c.files) ? c.files : []).map(normalizePath),
    }));
}

// Build the run document for the `runs` collection.
function toRunDocument(eventBody, project) {
  const payload = eventBody.payload || {};
  const eventId = eventBody.eventId;
  const startedAt = new Date(payload.startedAt);
  const finishedAt = new Date(payload.finishedAt);
  const durationMs =
    Number.isNaN(finishedAt.getTime()) || Number.isNaN(startedAt.getTime())
      ? 0
      : Math.max(0, finishedAt.getTime() - startedAt.getTime());

  const tests = (Array.isArray(payload.tests) ? payload.tests : []).map((t) => {
    const test = {
      name: String(t.name ?? "unnamed test"),
      file: normalizePath(t.file ?? ""),
      status: mapTestStatus(t.status),
      durationMs: Number(t.durationMs) || 0,
    };
    // error only exists when the test failed (per the contract)
    if (test.status === "failed" && t.error && t.error.message) {
      test.error = {
        message: redactText(String(t.error.message)),
        signature: t.error.signature || errorSignature(t.error.message),
      };
    }
    return test;
  });

  const commits = normalizeCommits(payload.commits);
  const envKeys = extractEnvKeys(payload.envKeys);
  const requiredEnvKeys =
    project && Array.isArray(project.requiredEnvKeys)
      ? project.requiredEnvKeys.map(String)
      : [];

  return {
    _id: runIdFromEventId(eventId),
    eventId,
    projectId: eventBody.projectId,
    commitSha: String(payload.commitSha ?? "unknown"),
    branch: String(payload.branch ?? "unknown"),
    author: String(payload.author ?? "unknown"),
    startedAt,
    finishedAt,
    durationMs,
    status: normalizeStatus(payload.status, tests, payload.collectorError),
    commits,
    changedFiles:
      Array.isArray(payload.changedFiles) && payload.changedFiles.length
        ? payload.changedFiles.map(normalizePath)
        : [...new Set(commits.flatMap((c) => c.files))],
    dependencies: normalizeDependencies(payload.dependencies),
    envKeys,
    missingEnvKeys: requiredEnvKeys.filter((key) => !envKeys.includes(key)),
    tests,
    // collectorError only exists when the run errored (per the contract)
    ...(payload.collectorError ? { collectorError: redactText(String(payload.collectorError)) } : {}),
    source: payload.source && typeof payload.source === "object" ? payload.source : {},
  };
}

module.exports = { toRunDocument, runIdFromEventId };
