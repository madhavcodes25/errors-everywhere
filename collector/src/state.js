// Collector state, kept in <project>/.errors-everywhere/:
//   state.json       - lastRunSha (for the git range), ciRunId counter,
//                      lastServer (so `resend` knows where to send)
//   last-event.json  - the exact event that was sent last (for `resend`)

const fs = require("fs");
const path = require("path");

const STATE_DIR = ".errors-everywhere";

function statePath(cwd) {
  return path.join(cwd, STATE_DIR, "state.json");
}

function lastEventPath(cwd) {
  return path.join(cwd, STATE_DIR, "last-event.json");
}

// Load state; a missing/corrupt file just means "first run".
function loadState(cwd) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(cwd), "utf8"));
    return { lastRunSha: state.lastRunSha || null, ciRunId: state.ciRunId || 0, lastServer: state.lastServer || null };
  } catch {
    return { lastRunSha: null, ciRunId: 0, lastServer: null };
  }
}

// ciRunId is a simple counter (contract: eventId = sha1(project:commit:ciRunId:attempt)).
function nextCiRunId(state) {
  return `local-${(state.ciRunId || 0) + 1}`;
}

// Persist state AFTER a successful send (a failed send must not advance the
// counter or lastRunSha, so the next attempt covers the same ground).
function saveState(cwd, { lastRunSha, ciRunId, lastServer }) {
  fs.mkdirSync(path.join(cwd, STATE_DIR), { recursive: true });
  fs.writeFileSync(
    statePath(cwd),
    JSON.stringify({ lastRunSha, ciRunId, lastServer, lastRunAt: new Date().toISOString() }, null, 2)
  );
}

// Save the exact event we are about to send, so `errors-everywhere resend` can send
// the byte-identical event again (this is how duplicate protection is demoed).
function saveLastEvent(cwd, event) {
  fs.mkdirSync(path.join(cwd, STATE_DIR), { recursive: true });
  fs.writeFileSync(lastEventPath(cwd), JSON.stringify(event, null, 2));
}

function loadLastEvent(cwd) {
  return JSON.parse(fs.readFileSync(lastEventPath(cwd), "utf8"));
}

module.exports = { loadState, saveState, saveLastEvent, loadLastEvent, nextCiRunId, STATE_DIR };
