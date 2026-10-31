// Seed 40 realistic historical runs directly into MongoDB, following the
// runs data contract exactly, with BUILT-IN patterns so the analysis engine
// has real signal:
//
//   1. ~60% of runs that change src/payment.js fail on "payment charges card"
//   2. README.md changes never cause failures
//   3. "refund works" is flaky: passes AND fails on the SAME commit
//   4. two past failures share one error signature, later fixed by a commit
//      that touched src/discount.js ("seen before, fixed in ...")
//   5. one express major bump caused several failures, then was reverted
//   6. one run is status "errored" (collector crash)
//
// Re-runnable: seeded documents (source.seed = true) are deleted first, and
// a fixed PRNG seed + stable fake SHAs make the result identical every time.
//
// Usage:
//   MONGODB_URI="mongodb+srv://..." node scripts/seed.js   # persistent (Atlas)
//   node scripts/seed.js --memory                          # temporary (demo/verify)
//
// The seeder reuses the server's own helpers (computeEventId, errorSignature)
// so seeded data matches what the live pipeline would produce.

const path = require("path");
// Reuse the server's dependencies (mongodb driver, memory server) so this
// script needs no package.json of its own.
module.paths.push(path.join(__dirname, "..", "server", "node_modules"));

const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const config = require("../server/src/config");
const { computeEventId } = require("../server/src/ingest");
const { errorSignature } = require("../server/src/lib/signature");
const { setupDatabase } = require("../server/src/dbSetup");
const { diagnoseRun } = require("../server/src/analysis/diagnose");
const { rankCulprits } = require("../server/src/analysis/culprits");
const { buildReleaseCheck } = require("../server/src/analysis/releaseCheck");

const PROJECT_ID = "shop-api";
const REQUIRED_ENV_KEYS = ["DATABASE_URL", "STRIPE_KEY"];
const PRNG_SEED = 20261031; // fixed -> same data every run
const TOTAL_RUNS = 40;
const DAYS_SPAN = 30;

// ---------------------------------------------------------------------------
// Deterministic randomness (mulberry32 — tiny, seedable, no dependencies)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(PRNG_SEED);

// Stable fake commit SHAs: derived from a fixed key, 40 hex chars like real ones.
function fakeSha(key) {
  return crypto.createHash("sha1").update("errors-everywhere-seed:" + key).digest("hex");
}

// ---------------------------------------------------------------------------
// The people and the code
// ---------------------------------------------------------------------------
const AUTHORS = {
  alice: ["Alice Chen", "alice@example.com"],
  marcus: ["Marcus Webb", "marcus@example.com"],
  priya: ["Priya Nair", "priya@example.com"],
  diego: ["Diego Ruiz", "diego@example.com"],
};

// The 14 tests of the sample project (name + file + typical duration in ms).
const TEST_SPECS = [
  { key: "cart-add", name: "adds a new item to the cart", file: "tests/cart.test.js", base: 40 },
  { key: "cart-merge", name: "merges quantities when the same sku is added twice", file: "tests/cart.test.js", base: 35 },
  { key: "cart-remove", name: "removes an item from the cart", file: "tests/cart.test.js", base: 30 },
  { key: "cart-unknown", name: "throws when removing an unknown sku", file: "tests/cart.test.js", base: 25 },
  { key: "discount-round", name: "applies a percentage discount with correct rounding", file: "tests/discount.test.js", base: 45 },
  { key: "discount-range", name: "rejects discount percentages outside 0-100", file: "tests/discount.test.js", base: 20 },
  { key: "discount-tier", name: "applies tier discounts for larger carts", file: "tests/discount.test.js", base: 35 },
  { key: "pay-charge", name: "payment charges card", file: "tests/payment.test.js", base: 120 },
  { key: "pay-invalid", name: "payment rejects invalid amounts", file: "tests/payment.test.js", base: 20 },
  { key: "pay-config", name: "payment requires STRIPE_KEY to be configured", file: "tests/payment.test.js", base: 15 },
  { key: "pay-refund", name: "payment refunds a charge", file: "tests/payment.test.js", base: 60 },
  { key: "auth-token", name: "auth issues and verifies a token", file: "tests/auth.test.js", base: 80 },
  { key: "auth-expired", name: "auth rejects an expired token", file: "tests/auth.test.js", base: 30 },
  { key: "auth-hash", name: "auth hashes passwords with a unique salt", file: "tests/auth.test.js", base: 90 },
];
// The flaky test that scenario D adds (introduced in run 29 of the history).
const REFUND_SPEC = { key: "refund", name: "refund works", file: "tests/payment.test.js", base: 110 };

// Error messages per failure kind. "pay-charge" and "refund" are written to
// EXACTLY match what the live sample project throws, so seeded history and
// live demo runs share error signatures — Errors Everywhere then says "seen before".
const ERROR_MESSAGES = {
  "pay-charge": "payment charges card: expected charge 102.9 but got 100",
  "discount-round": "discount rounding mismatch: got 33.71 but expected 33.72",
  "auth-token": "auth: express 5 broke session middleware — Cannot read properties of undefined (reading 'session')",
  refund: "refund works: refund API timed out after 5000 ms",
};
const FAILURE_TO_TEST = { payment: "pay-charge", discount: "discount-round", dep: "auth-token", refund: "refund" };

// Commit shortcut: C(key, message, authorKey, files) — sha is stable per key.
function C(key, message, authorKey, files) {
  return { sha: fakeSha(key), message, author: AUTHORS[authorKey][0], files };
}

// ---------------------------------------------------------------------------
// The 40-run history table (oldest first).
// fail: "payment" | "discount" | "dep" | "refund"  ·  errored: collector crash
// deps5: run happened while express ^5.1.0 was installed (the bump window)
// ---------------------------------------------------------------------------
const RUNS = [
  /*  0 */ { commits: [C("cart-add-feat", "feat: add to cart helper", "alice", ["src/cart.js", "tests/cart.test.js"])] },
  /*  1 */ { commits: [C("readme-checkout", "docs: describe checkout flow", "alice", ["README.md"])] },
  /*  2 */ { commits: [C("auth-feature", "feat: token based auth", "priya", ["src/auth.js", "tests/auth.test.js"])] },
  /*  3 */ { commits: [C("tiered-discounts", "feat: tiered discounts", "priya", ["src/discount.js", "tests/discount.test.js"])] },
  /*  4 */ { commits: [C("readme-typo", "docs: fix typo in README", "diego", ["README.md"])] },
  /*  5 */ { commits: [C("cart-counting", "refactor: cart item counting", "marcus", ["src/cart.js"])] },
  /*  6 */ { commits: [C("discount-reformat", "style: reformat discount module", "marcus", ["src/discount.js"])] },
  /*  7 */ { commits: [C("card-charges", "feat: card charges via stripe", "marcus", ["src/payment.js", "tests/payment.test.js"])] },
  /*  8 */ { commits: [C("discount-tidy", "chore: tidy discount helpers", "priya", ["src/discount.js"])] },
  /*  9 */ { fail: "payment", commits: [C("fee-skip-perf", "perf: skip fee rounding on small amounts", "marcus", ["src/payment.js"])] },
  /* 10 */ { commits: [C("readme-faq", "docs: payment FAQ", "alice", ["README.md"]), C("cart-validation", "chore: cart sku validation", "diego", ["src/cart.js"])] },
  /* 11 */ { fail: "payment", commits: [C("charge-retry", "fix: retry failed charges", "marcus", ["src/payment.js"])] },
  /* 12 */ { deps5: true, commits: [C("express-bump", "chore(deps): upgrade express to v5", "priya", ["package.json"])] },
  /* 13 */ { fail: "dep", deps5: true, commits: [C("session-mw-fix1", "fix: session middleware for express 5", "diego", ["src/auth.js"])] },
  /* 14 */ { fail: "dep", deps5: true, commits: [C("session-mw-fix2", "fix: another session middleware attempt", "diego", ["src/auth.js"])] },
  /* 15 */ { commits: [C("express-revert", "revert: roll back express to v4 until sessions are stable", "priya", ["package.json"])] },
  /* 16 */ { fail: "payment", commits: [C("saved-cards", "feat: saved cards", "marcus", ["src/payment.js"])] },
  /* 17 */ { commits: [C("readme-trouble", "docs: troubleshooting section", "alice", ["README.md"])] },
  /* 18 */ { fail: "payment", commits: [C("cart-totals", "refactor: cart totals", "diego", ["src/cart.js"]), C("fee-refund-fix", "fix: fee calculation on refunds", "marcus", ["src/payment.js"])] },
  /* 19 */ { commits: [C("discount-helpers", "refactor: extract discount helpers", "priya", ["src/discount.js"])] },
  /* 20 */ { errored: true, commits: [C("remember-me", "feat: remember me sessions", "priya", ["src/auth.js"])] },
  /* 21 */ { commits: [C("jest-heap", "chore: bump jest workers memory limit", "priya", ["jest.config.js"])] },
  /* 22 */ { fail: "discount", commits: [C("discount-rounding-regression", "refactor: simplify discount rounding", "marcus", ["src/discount.js"])] },
  /* 23 */ { commits: [C("readme-api-link", "docs: update api docs link", "alice", ["README.md"])] },
  /* 24 */ { fail: "payment", commits: [C("gift-card-pay", "feat: gift card payments", "diego", ["src/payment.js"]), C("gift-card-tests", "test: gift card cases", "diego", ["tests/payment.test.js"])] },
  /* 25 */ { commits: [C("cart-split", "refactor: split cart helpers", "marcus", ["src/cart.js"])] },
  /* 26 */ { fail: "discount", commits: [C("discount-tier-helpers", "refactor: discount tier helpers", "priya", ["src/discount.js"])] },
  /* 27 */ { commits: [C("token-refresh", "feat: token refresh", "priya", ["src/auth.js", "tests/auth.test.js"]), C("discount-round-fix", "fix: round discounts half up", "priya", ["src/discount.js"])] },
  /* 28 */ { commits: [C("readme-discount-doc", "docs: discount policy", "alice", ["README.md"]), C("discount-edge", "fix: discount edge case", "priya", ["src/discount.js"])] },
  /* 29 */ { commits: [C("refund-flow", "feat: refund flow with tests", "marcus", ["src/payment.js", "tests/payment.test.js"])] },
  /* 30 */ { commits: [C("refund-client", "refactor: extract refund client", "marcus", ["src/payment.js"])] },
  /* 31 */ { fail: "refund", commits: [C("refund-client", "refactor: extract refund client", "marcus", ["src/payment.js"])] },
  /* 32 */ { commits: [C("refund-client", "refactor: extract refund client", "marcus", ["src/payment.js"])] },
  /* 33 */ { fail: "payment", commits: [C("fee-edge-cases", "fix: fee edge cases in checkout", "diego", ["src/payment.js"])] },
  /* 34 */ { commits: [C("readme-refund-policy", "docs: refund policy", "alice", ["README.md"])] },
  /* 35 */ { commits: [C("discount-tiers2", "refactor: discount tiers", "priya", ["src/discount.js"]), C("cart-cleanup", "chore: cart cleanup", "marcus", ["src/cart.js"])] },
  /* 36 */ { fail: "payment", commits: [C("declined-cards", "feat: handle declined cards", "diego", ["src/payment.js"])] },
  /* 37 */ { commits: [C("session-revoke", "feat: session revocation", "priya", ["src/auth.js"])] },
  /* 38 */ { commits: [C("readme-security", "docs: security notes", "alice", ["README.md"])] },
  /* 39 */ { commits: [C("cart-tidy", "chore: tidy cart module", "marcus", ["src/cart.js"])] },
];

// The dependency list at run time (matches sample-project/package.json).
const DEPS_BASE = [
  { name: "express", version: "^4.21.2" },
  { name: "stripe", version: "^14.0.0" },
  { name: "lodash", version: "^4.17.21" },
];
const DEPS_EXPRESS5 = [
  { name: "express", version: "^5.1.0" },
  { name: "stripe", version: "^14.0.0" },
  { name: "lodash", version: "^4.17.21" },
];

// ---------------------------------------------------------------------------
// Run construction
// ---------------------------------------------------------------------------

// Build the tests array for one run.
function buildTests(failureKind, includeRefund) {
  const failingKey = failureKind ? FAILURE_TO_TEST[failureKind] : null;
  const specs = includeRefund ? [...TEST_SPECS, REFUND_SPEC] : TEST_SPECS;
  return specs.map((spec) => {
    const failed = spec.key === failingKey;
    const test = {
      name: spec.name,
      file: spec.file,
      status: failed ? "failed" : "passed",
      durationMs: Math.round(spec.base * (0.7 + rand() * 0.6)),
    };
    if (failed) {
      const message = ERROR_MESSAGES[spec.key];
      test.error = { message, signature: errorSignature(message) };
    }
    return test;
  });
}

// Build one run document following the contract exactly.
function buildRun(index) {
  const spec = RUNS[index];
  const commits = spec.commits;
  const head = commits[commits.length - 1];

  const ciRunId = `seed-run-${index}`;
  const eventId = computeEventId({ projectId: PROJECT_ID, commitSha: head.sha, ciRunId, attempt: 1 });

  // Realistic timestamps spread over the last 30 days (newest = index 39).
  const spacingMs = (DAYS_SPAN * 24 * 3600 * 1000) / TOTAL_RUNS;
  const jitterMs = Math.floor(rand() * 6 * 3600 * 1000); // < spacing, keeps order
  const startedAt = new Date(Date.now() - (TOTAL_RUNS - 1 - index) * spacingMs - jitterMs);

  const tests = spec.errored ? [] : buildTests(spec.fail, index >= 29);
  const durationMs = spec.errored
    ? 4000 + Math.round(rand() * 2000)
    : tests.reduce((sum, t) => sum + t.durationMs, 0) + 800 + Math.round(rand() * 400);
  const finishedAt = new Date(startedAt.getTime() + durationMs);

  const status = spec.errored ? "errored" : tests.some((t) => t.status === "failed") ? "failed" : "passed";

  const run = {
    _id: "run_" + eventId.slice(0, 12),
    eventId,
    projectId: PROJECT_ID,
    commitSha: head.sha,
    branch: "main",
    author: head.author,
    startedAt,
    finishedAt,
    durationMs,
    status,
    commits,
    changedFiles: [...new Set(commits.flatMap((c) => c.files))],
    dependencies: spec.deps5 ? DEPS_EXPRESS5 : DEPS_BASE,
    envKeys: [...REQUIRED_ENV_KEYS], // names only, never values
    missingEnvKeys: [],
    tests,
    source: { seed: true, seedVersion: 1, ci: "seed-script" },
  };
  if (spec.errored) {
    run.collectorError =
      "Jest worker ran out of memory: JavaScript heap out of memory — no test results were reported";
  }
  return run;
}

// ---------------------------------------------------------------------------
// Seeding + verification
// ---------------------------------------------------------------------------

// Build the 40 seeded run documents (deterministic; no database needed).
function buildSeededRuns() {
  return RUNS.map((_, index) => buildRun(index));
}

// Seed runs + the project document. Re-runnable: only seeded docs are cleared.
async function seedDatabase(db) {
  const runs = buildSeededRuns();

  await db.collection("projects").updateOne(
    { _id: PROJECT_ID },
    { $set: { name: PROJECT_ID, requiredEnvKeys: REQUIRED_ENV_KEYS } },
    { upsert: true }
  );
  await db.collection("runs").deleteMany({ "source.seed": true });
  await db.collection("runs").insertMany(runs);
  return runs;
}

// Acceptance check: query the seeded data and confirm every pattern exists.
async function verifyPatterns(db) {
  const runs = db.collection("runs");
  const seeded = { "source.seed": true };
  let allOk = true;
  const check = (label, ok, detail) => {
    if (!ok) allOk = false;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const total = await runs.countDocuments(seeded);
  check("runs has 40 seeded documents", total === TOTAL_RUNS, `found ${total}`);

  const paymentChanged = await runs.countDocuments({ ...seeded, "commits.files": "src/payment.js" });
  const paymentFailed = await runs.countDocuments({ ...seeded, "commits.files": "src/payment.js", status: "failed" });
  const rate = paymentFailed / paymentChanged;
  check(
    "~60% of src/payment.js-touching runs fail on the charges test",
    Math.abs(rate - 0.6) <= 0.15,
    `${paymentFailed}/${paymentChanged} = ${Math.round(rate * 100)}%`
  );

  const readmeRuns = await runs.find({ ...seeded, "commits.files": "README.md" }).toArray();
  check(
    "README.md changes never cause failures",
    readmeRuns.length >= 4 && readmeRuns.every((r) => r.status === "passed"),
    `${readmeRuns.length} README runs, all passed: ${readmeRuns.every((r) => r.status === "passed")}`
  );

  const flakySha = fakeSha("refund-client");
  const flakyRuns = await runs.find({ ...seeded, commitSha: flakySha }).sort({ startedAt: 1 }).toArray();
  const outcomes = flakyRuns.map((r) => r.status).join(",");
  check(
    '"refund works" passes AND fails on the SAME commit',
    flakyRuns.length >= 2 && outcomes.includes("passed") && outcomes.includes("failed"),
    `commit ${flakySha.slice(0, 7)} in ${flakyRuns.length} runs -> [${outcomes}]`
  );

  const discountSig = errorSignature(ERROR_MESSAGES["discount-round"]);
  const discountFailures = await runs
    .find({ ...seeded, tests: { $elemMatch: { status: "failed", "error.signature": discountSig } } })
    .sort({ startedAt: 1 })
    .toArray();
  const fixRun = await runs.findOne({
    ...seeded,
    status: "passed",
    "commits.message": { $regex: /round discounts half up/i },
    "commits.files": "src/discount.js",
  });
  check(
    "2 past failures share one signature, fixed by a later src/discount.js commit",
    discountFailures.length === 2 && Boolean(fixRun),
    `signature seen in ${discountFailures.length} runs; fix commit ${fixRun ? fixRun.commits[0].sha.slice(0, 7) : "MISSING"}`
  );

  const depFilter = { ...seeded, dependencies: { $elemMatch: { name: "express", version: "^5.1.0" } } };
  const depRuns = await runs.countDocuments(depFilter);
  const depFailed = await runs.countDocuments({ ...depFilter, status: "failed" });
  check(
    "express major bump caused several failures, then was reverted",
    depRuns === 3 && depFailed === 2,
    `${depRuns} runs on express 5, ${depFailed} failed`
  );

  const errored = await runs.countDocuments({ ...seeded, status: "errored" });
  check("exactly 1 errored run (collector crash)", errored === 1, `found ${errored}`);

  return allOk;
}

// Bonus proof: the seeded data actually drives the analysis engine.
async function demoAnalysis(db) {
  const collections = { runs: db.collection("runs") };

  const worst = await db
    .collection("runs")
    .find({ ...{ "source.seed": true }, status: "failed", "commits.files": "src/payment.js" })
    .sort({ startedAt: -1 })
    .limit(1)
    .toArray()
    .then((arr) => arr[0]);

  console.log("\nAnalysis on seeded data (sanity check):");

  const diagnosis = await diagnoseRun(collections, worst._id);
  const verdicts = diagnosis.body.tests.map((t) => `${t.name} -> ${t.verdict}`).join("; ");
  console.log(`  diagnosis  ${worst._id}: confidence=${diagnosis.body.confidence}`);
  console.log(`    -> ${verdicts}`);

  const culprits = await rankCulprits(collections, worst._id);
  const top = culprits.body.candidates[0];
  console.log(`  culprits   ${worst._id}: top=${top.sha.slice(0, 7)} (${top.scorePct}%) "${top.message}"`);
  console.log(`    -> ${top.reasons[0]}`);

  const release = await buildReleaseCheck(collections, PROJECT_ID);
  console.log(`  release    ${PROJECT_ID}: score=${release.body.score}/100 level=${release.body.level} blocked=${release.body.blocked}`);
  console.log(`    -> ${release.body.recommendation}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const memory = process.argv.includes("--memory");
  let uri = config.mongoUri;
  let replSet = null;

  if (memory || !uri) {
    if (!memory) {
      console.warn("MONGODB_URI is not set — falling back to a TEMPORARY in-memory replica set.");
      console.warn("The data disappears when this script exits. For a persistent demo:");
      console.warn('  MONGODB_URI="mongodb+srv://..." node scripts/seed.js');
    }
    const { MongoMemoryReplSet } = require("mongodb-memory-server");
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri(config.dbName);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(config.dbName);
  console.log(`Seeding ${TOTAL_RUNS} runs into ${config.dbName} (fixed PRNG seed ${PRNG_SEED})...`);

  // Ensure collections, $jsonSchema validators and indexes exist on the
  // target database (idempotent — same routine the server runs at boot).
  await setupDatabase(db);

  await seedDatabase(db);
  console.log(`Done. Verifying built-in patterns:\n`);
  const ok = await verifyPatterns(db);
  await demoAnalysis(db);

  await client.close();
  if (replSet) await replSet.stop();
  process.exit(ok ? 0 : 1);
}

// Only run when invoked directly (node scripts/seed.js) — the analysis
// acceptance tests require this module for seedDatabase().
if (require.main === module) {
  main().catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
}

module.exports = { seedDatabase, verifyPatterns, buildSeededRuns, TEST_SPECS, DEPS_BASE };
