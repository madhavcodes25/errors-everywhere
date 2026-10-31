// Build the event payload following the Errors Everywhere data contract, and the
// idempotent eventId: sha1(projectId:commitSha:ciRunId:attempt).
// KEEP IN SYNC with server/src/ingest.js (computeEventId) — the server
// recomputes it and rejects mismatches.

const os = require("os");
const crypto = require("crypto");

function computeEventId({ projectId, commitSha, ciRunId, attempt }) {
  const raw = `${projectId}:${commitSha}:${ciRunId}:${attempt}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

// Assemble the event from the pieces the collector gathered. Missing pieces
// (because a collector step crashed) become "unknown"/[] — the event is still
// sent, with status "errored" and a collectorError message.
function buildEvent({ projectId, startedAt, finishedAt, status, jestInfo, gitInfo, deps, env, problems, ciRunId }) {
  const attempt = 1;
  const commitSha = gitInfo ? gitInfo.commitSha : "unknown";
  const eventId = computeEventId({ projectId, commitSha, ciRunId, attempt });

  const payload = {
    projectName: projectId,
    requiredEnvKeys: env.requiredEnvKeys, // names only, never values
    commitSha,
    branch: gitInfo ? gitInfo.branch : "unknown",
    author: gitInfo ? gitInfo.author : "unknown",
    ciRunId: String(ciRunId),
    attempt,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status,
    commits: gitInfo ? gitInfo.commits : [],
    changedFiles: gitInfo ? gitInfo.changedFiles : [],
    dependencies: deps, // array of { name, version }
    envKeys: env.envKeys, // names only, never values
    missingEnvKeys: env.missingEnvKeys,
    tests: jestInfo ? jestInfo.tests : [],
    source: { ci: "errors-everywhere-collector", host: os.hostname(), node: process.version },
  };
  if (status === "errored") {
    payload.collectorError = problems.join(" | ") || "collector failed for an unknown reason";
  }

  return { eventId, projectId, type: "run.completed", timestamp: new Date().toISOString(), payload };
}

module.exports = { buildEvent, computeEventId };
