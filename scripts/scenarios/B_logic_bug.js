// Scenario B — logic bug: drop the payment processing fee so the
// "payment charges card" test fails. The error message matches the one in
// the seeded history, so TraceBack recognizes it as a RECURRING failure.

const {
  ensureCleanState, replaceInFile, commitAll, runJest, report, shouldRestore, resetSampleProject,
} = require("./lib");

const NAME = "B_logic_bug";

function apply() {
  ensureCleanState();
  replaceInFile(
    "src/payment.js",
    "const FEE_RATE = 0.029;",
    "const FEE_RATE = 0; // DEMO BUG: processing fee dropped"
  );
  const sha = commitAll("fix: drop the processing fee at checkout", "Marcus Webb", "marcus@example.com");
  console.log(`[${NAME}] committed ${sha.slice(0, 7)} — "fix: drop the processing fee at checkout"`);
  return sha;
}

function run() {
  apply();
  const result = runJest();
  const ok = result.code !== 0 && result.failed === 1 && result.output.includes("payment charges card");
  report(NAME, 'exactly 1 failing test: "payment charges card"', ok,
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
