// Shared helpers for the one-command demo scripts (npm run demo:*).
// Every script talks to the RUNNING TraceBack server through its API —
// exactly what a judge can watch in the dashboard.

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SAMPLE = path.join(ROOT, "sample-project");
const COLLECTOR = path.join(ROOT, "collector", "bin", "traceback.js");

function serverUrl() {
  const i = process.argv.indexOf("--server");
  return (i !== -1 && process.argv[i + 1]) || "http://localhost:4000";
}

async function post(path, body) {
  const res = await fetch(serverUrl() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body: json };
}

// Run the collector CLI against the sample project (records a real run).
function runCollector() {
  const result = spawnSync(
    process.execPath,
    [COLLECTOR, "run", "--project", "shop-api", "--server", serverUrl()],
    { cwd: SAMPLE, encoding: "utf8" }
  );
  return {
    code: result.status,
    output: ((result.stdout || "") + (result.stderr || "")).trim(),
  };
}

function step(text) {
  console.log(`\n[demo] ${text}`);
}

module.exports = { ROOT, SAMPLE, COLLECTOR, serverUrl, post, runCollector, step };
