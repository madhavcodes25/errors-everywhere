// Collector orchestration: gather everything, build the event, send it,
// print a human summary. Individual steps are guarded — a crash in one step
// (jest cannot start, git fails, ...) still produces a status "errored" run
// with whatever partial info was collected. Never fail silently.

const { runJest } = require("./jest");
const { readGitInfo } = require("./git");
const { readDependencies } = require("./deps");
const { readEnvKeys } = require("./env");
const { loadState, saveState, saveLastEvent, loadLastEvent, nextCiRunId } = require("./state");
const { buildEvent } = require("./event");
const { postEvent } = require("./send");

async function runCollector({ projectId, serverUrl, cwd }) {
  const startedAt = new Date();
  const state = loadState(cwd);
  const problems = []; // collector-side failures -> status "errored"

  // 1) Jest. A non-zero exit because TESTS failed is normal (runJest handles
  //    that); only "no JSON results at all" throws here.
  let jestInfo = null;
  try {
    jestInfo = runJest(cwd);
  } catch (err) {
    problems.push(`jest: ${err.message}${err.detail ? ` [${err.detail}]` : ""}`);
  }

  // 2) Git: current commit + commits since the last recorded run.
  let gitInfo = null;
  try {
    gitInfo = readGitInfo(cwd, state.lastRunSha);
  } catch (err) {
    problems.push(`git: ${err.message}`);
  }

  // 3) Declared dependencies (array of { name, version }).
  let deps = [];
  try {
    deps = readDependencies(cwd);
  } catch (err) {
    problems.push(`dependencies: ${err.message}`);
  }

  // 4) Environment variable NAMES (never values).
  let env = { requiredEnvKeys: [], envKeys: [], missingEnvKeys: [] };
  try {
    env = readEnvKeys(cwd);
  } catch (err) {
    problems.push(`env: ${err.message}`);
  }

  const status = problems.length > 0 ? "errored" : jestInfo.status;
  const ciRunId = nextCiRunId(state);
  const event = buildEvent({ projectId, startedAt, finishedAt: new Date(), status, jestInfo, gitInfo, deps, env, problems, ciRunId });

  // 5) Remember the exact event so `errors-everywhere resend` can repeat it verbatim.
  saveLastEvent(cwd, event);

  // 6) Send it (timeout + 3 retries with backoff).
  console.log(`[errors-everywhere] sending event ${event.eventId.slice(0, 12)}… to ${serverUrl}/events`);
  const result = await postEvent(serverUrl, event);

  if (result.ok) {
    // Advance state only after a successful send, so a failed send does not
    // create a gap in the recorded history.
    saveState(cwd, {
      lastRunSha: gitInfo ? gitInfo.commitSha : state.lastRunSha,
      ciRunId: state.ciRunId + 1,
      lastServer: serverUrl,
    });
  }

  printSummary({ result, event, status, jestInfo, gitInfo, env, problems });
  return result.ok ? 0 : 1;
}

// `errors-everywhere resend` — send the EXACT same event again (duplicate demo).
async function resendLastEvent({ serverUrl, cwd }) {
  let event;
  try {
    event = loadLastEvent(cwd);
  } catch {
    console.error(`[errors-everywhere] no ${cwd}/.errors-everywhere/last-event.json found — run "errors-everywhere run" first.`);
    return 1;
  }

  console.log(`[errors-everywhere] re-sending event ${event.eventId.slice(0, 12)}… to ${serverUrl}/events`);
  const result = await postEvent(serverUrl, event);

  const duplicate = result.ok && result.body && (result.body.status === "duplicate_ignored" || result.body.duplicate);
  if (result.ok && duplicate) {
    console.log(`Duplicate ignored: event ${event.eventId.slice(0, 12)}… was already stored (idempotency works — nothing changed).`);
  } else if (result.ok) {
    console.log(`Run sent: ${event.payload.status}, event ${event.eventId.slice(0, 12)}… stored (runId ${result.body && result.body.runId})`);
  } else {
    printSendFailure(result);
  }
  return result.ok ? 0 : 1;
}

function printSummary({ result, event, status, jestInfo, gitInfo, env, problems }) {
  // Context lines first.
  if (jestInfo) {
    console.log(`[errors-everywhere] jest: ${jestInfo.passed} passed, ${jestInfo.failed} failed, ${jestInfo.tests.length} total`);
  } else {
    console.log("[errors-everywhere] jest: no results (see collectorError below)");
  }
  if (gitInfo) {
    console.log(`[errors-everywhere] git: ${gitInfo.commits.length} commit(s) since last run (${gitInfo.range})`);
  } else {
    console.log("[errors-everywhere] git: unavailable");
  }
  console.log(
    `[errors-everywhere] env: ${env.envKeys.length}/${env.requiredEnvKeys.length} required keys present` +
      (env.missingEnvKeys.length ? ` (missing: ${env.missingEnvKeys.join(", ")})` : "")
  );

  if (!result.ok) {
    printSendFailure(result);
    return;
  }
  const shortId = `${event.eventId.slice(0, 12)}…`;
  if (result.body && (result.body.status === "duplicate_ignored" || result.body.duplicate)) {
    console.log(`Duplicate ignored: event ${shortId} was already stored (idempotency works — nothing changed).`);
    return;
  }
  if (status === "errored") {
    console.log(`Run sent: ERRORED, event ${shortId} stored (runId ${result.body && result.body.runId})`);
    for (const problem of problems) console.log(`  collectorError: ${problem}`);
  } else {
    const failing = jestInfo ? jestInfo.failed : 0;
    console.log(`Run sent: ${status.toUpperCase()}, ${failing} test${failing === 1 ? "" : "s"} failing, event ${shortId} stored (runId ${result.body && result.body.runId})`);
  }
}

function printSendFailure(result) {
  if (result.permanent) {
    console.error(`[errors-everywhere] server REJECTED the event (HTTP ${result.status}): ${JSON.stringify(result.body)}`);
    console.error("[errors-everywhere] this is a bug in the collector's payload — please report it.");
  } else {
    console.error(`[errors-everywhere] could not reach the server after 3 retries: ${result.error}`);
    console.error("[errors-everywhere] the event was saved to .errors-everywhere/last-event.json — use \"errors-everywhere resend\" once the server is up.");
  }
}

module.exports = { runCollector, resendLastEvent };
