// Scenario F — commit bundle (the main Culprit Ranking demo): three commits
// land together and ONE run covers all of them.
//   1. README edit            (innocent)
//   2. cart.js comment tweak  (innocent)
//   3. payment.js fee removal (THE CULPRIT)
// Then the tests run once and "payment charges card" fails. Errors Everywhere should
// blame commit 3, not the bundle as a whole.

const fs = require("fs");
const path = require("path");
const {
  ensureCleanState, replaceInFile, commitAll, runJest, report, shouldRestore, resetSampleProject, SAMPLE_DIR,
} = require("./lib");

const NAME = "F_commit_bundle";

function apply() {
  ensureCleanState();

  // Commit 1: docs only — never causes failures (matches the seeded pattern).
  fs.appendFileSync(
    path.join(SAMPLE_DIR, "README.md"),
    "- Checkout applies a 2.9% processing fee at charge time.\n"
  );
  const sha1 = commitAll("docs: document checkout fees", "Alice Chen", "alice@example.com");

  // Commit 2: harmless refactor — a clarifying comment in cart.js.
  replaceInFile(
    "src/cart.js",
    "function addToCart",
    "// Carts are plain arrays of { sku, price, qty } items.\nfunction addToCart"
  );
  const sha2 = commitAll("refactor: clarify cart item shape", "Diego Ruiz", "diego@example.com");

  // Commit 3: the real culprit — same fee bug as scenario B.
  replaceInFile(
    "src/payment.js",
    "const FEE_RATE = 0.029;",
    "const FEE_RATE = 0; // DEMO BUG: fee dropped during checkout rewrite"
  );
  const sha3 = commitAll("fix: apply fee after tax in checkout", "Marcus Webb", "marcus@example.com");

  console.log(`[${NAME}] 3 commits:`);
  console.log(`  1. ${sha1.slice(0, 7)} docs: document checkout fees (README.md)`);
  console.log(`  2. ${sha2.slice(0, 7)} refactor: clarify cart item shape (src/cart.js)`);
  console.log(`  3. ${sha3.slice(0, 7)} fix: apply fee after tax in checkout (src/payment.js)  <- culprit`);
  return [sha1, sha2, sha3];
}

function run() {
  apply();
  // ONE test run covers the whole bundle — this is the situation where
  // "which commit broke it?" is genuinely hard without a tool like Errors Everywhere.
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
