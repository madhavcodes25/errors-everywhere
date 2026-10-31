// Scenario A — healthy baseline: no changes, no commit, everything passes.
// Use it to record a green run (e.g. right after seeding or resetting).

const { ensureCleanState, runJest, report, shouldRestore } = require("./lib");

const NAME = "A_healthy";

function apply() {
  // No change — that is the point of the healthy scenario.
}

function run() {
  ensureCleanState();
  apply();
  const result = runJest();
  const ok = result.code === 0 && result.passed === 14 && result.failed === 0;
  report(NAME, "all 14 tests pass, exit code 0",
    ok,
    `exit ${result.code}, ${result.passed} passed, ${result.failed} failed`);
  return ok;
}

if (require.main === module) {
  const ok = run();
  console.log(`[${NAME}] no changes were made, nothing to reset.`);
  process.exit(ok ? 0 : 1);
}

module.exports = { apply, run };
