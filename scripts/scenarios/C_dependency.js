// Scenario C — dependency upgrade: bump express to a new MAJOR version and
// let a sloppy migration slip into src/discount.js (>= becomes >), so the
// tier-discount test fails. TraceBack should show the dependency diff and
// rank the bump commit as the culprit.

const {
  ensureCleanState, replaceInFile, commitAll, runJest, report, shouldRestore, resetSampleProject,
} = require("./lib");

const NAME = "C_dependency";

function apply() {
  ensureCleanState();
  // The major bump itself (declared dependency; node_modules is untouched —
  // tests do not import express, the failure comes from the migration edit).
  replaceInFile("package.json", '"express": "^4.21.2"', '"express": "^5.1.0"');
  // The "migration" bug: tightening tier boundaries from >= to >.
  replaceInFile("src/discount.js", "cartTotal >= 500", "cartTotal > 500");
  replaceInFile("src/discount.js", "cartTotal >= 200", "cartTotal > 200");
  replaceInFile("src/discount.js", "cartTotal >= 50", "cartTotal > 50");
  const sha = commitAll(
    "chore(deps): upgrade express to v5 and simplify discount tiers",
    "Priya Nair", "priya@example.com"
  );
  console.log(`[${NAME}] committed ${sha.slice(0, 7)} — express ^4.21.2 -> ^5.1.0 + tier migration`);
  return sha;
}

function run() {
  apply();
  const result = runJest();
  const ok =
    result.code !== 0 &&
    result.failed === 1 &&
    result.output.includes("applies tier discounts for larger carts");
  report(NAME, 'exactly 1 failing test: "applies tier discounts for larger carts"', ok,
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
