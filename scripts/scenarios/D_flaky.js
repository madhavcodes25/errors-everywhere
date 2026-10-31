// Scenario D — flaky test: add a "refund works" test that fails ~30% of the
// time at random (simulating an intermittent third-party refund API).
// The failure message matches the seeded flaky history, so TraceBack can
// show "passes and fails on the SAME commit".

const fs = require("fs");
const path = require("path");
const {
  ensureCleanState, commitAll, runJest, report, shouldRestore, resetSampleProject, SAMPLE_DIR,
} = require("./lib");

const NAME = "D_flaky";

const FLAKY_TEST = `
test("refund works", () => {
  // Simulates an intermittent third-party refund API: ~30% of calls time out.
  if (Math.random() < 0.3) {
    throw new Error("refund works: refund API timed out after 5000 ms");
  }
  expect(refund("ch_123", 10).ok).toBe(true);
});
`;

function apply() {
  ensureCleanState();
  fs.appendFileSync(path.join(SAMPLE_DIR, "tests", "payment.test.js"), FLAKY_TEST);
  const sha = commitAll("test: add refund flow regression test", "Marcus Webb", "marcus@example.com");
  console.log(`[${NAME}] committed ${sha.slice(0, 7)} — added flaky "refund works" test`);
  return sha;
}

function run() {
  apply();
  const result = runJest();
  // Flaky means either outcome is valid: all pass, or exactly the refund test
  // fails. Anything else is a real problem.
  const ok =
    (result.failed === 0 && result.passed === 15) ||
    (result.failed === 1 && result.output.includes("refund works"));
  report(NAME, "flaky: either 15 pass, or exactly 1 fail on \"refund works\" (~30% of runs)", ok,
    `exit ${result.code}, ${result.passed} passed, ${result.failed} failed`);
  return ok;
}

if (require.main === module) {
  const ok = run();
  if (shouldRestore()) {
    resetSampleProject();
    console.log(`[${NAME}] changes restored (--restore).`);
  } else {
    console.log(`[${NAME}] changes KEPT — run node scripts/scenarios/reset.js to restore.`);
  }
  process.exit(ok ? 0 : 1);
}

module.exports = { apply, run };
