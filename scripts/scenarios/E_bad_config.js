// Scenario E — bad configuration: run the tests WITHOUT STRIPE_KEY in the
// environment (simulates a CI job with a missing secret). No file changes,
// no commit — the failure is purely environmental, which is exactly the kind
// of failure Errors Everywhere should recognize as "missing-env" rather than blame a
// commit.

const fs = require("fs");
const path = require("path");
const {
  ensureCleanState, runJest, report, shouldRestore, resetSampleProject, SAMPLE_DIR,
} = require("./lib");

const NAME = "E_bad_config";

// Strip STRIPE_KEY from .env (the file jest's setup loads into process.env).
function apply() {
  ensureCleanState();
  const envPath = path.join(SAMPLE_DIR, ".env");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  fs.writeFileSync(
    envPath,
    lines.filter((line) => !/^STRIPE_KEY=/.test(line)).join("\n")
  );
  console.log(`[${NAME}] removed STRIPE_KEY from sample-project/.env (environment-only change, no commit)`);
}

function run() {
  apply();
  const result = runJest();
  const ok =
    result.code !== 0 &&
    result.failed === 1 &&
    result.output.includes("payment requires STRIPE_KEY to be configured");
  report(NAME, 'exactly 1 failing test: "payment requires STRIPE_KEY to be configured"', ok,
    `exit ${result.code}, ${result.passed} passed, ${result.failed} failed`);
  return ok;
}

if (require.main === module) {
  const ok = run();
  if (shouldRestore()) {
    resetSampleProject();
    console.log(`[${NAME}] .env restored (--restore).`);
  } else {
    console.log(`[${NAME}] .env still missing STRIPE_KEY — run node scripts/scenarios/reset.js to restore.`);
  }
  process.exit(ok ? 0 : 1);
}

module.exports = { apply, run };
