// Shared helpers for the demo scenarios in this folder.
//
// Every scenario follows the same rhythm:
//   1. modify the sample project (except A_healthy / E_bad_config)
//   2. git commit the change (so the collector sees real commits)
//   3. run the Jest suite and report pass/fail
//   4. by default KEEP the changes applied — run `reset.js` to restore the
//      healthy state (or pass --restore to restore immediately).
//
// Run a scenario from anywhere: node scripts/scenarios/B_logic_bug.js

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SAMPLE_DIR = path.join(__dirname, "..", "..", "sample-project");

// Where demo scenario runs are expected to POST their events later.
// (The collector is a later part; scenarios only run the tests for now.)

// Run the sample project's Jest suite. Returns { code, passed, failed, output }.
function runJest() {
  const jestBin = path.join(SAMPLE_DIR, "node_modules", "jest", "bin", "jest.js");
  const result = spawnSync(process.execPath, [jestBin, "--silent"], {
    cwd: SAMPLE_DIR,
    encoding: "utf8",
  });
  const output = (result.stdout || "") + (result.stderr || "");
  const { passed, failed } = parseSummary(output);
  return { code: result.status, passed, failed, output };
}

// Parse jest's "Tests: 13 passed, 1 failed, 14 total" summary line.
function parseSummary(output) {
  const line = (String(output).match(/^\s*Tests:\s+(.+)$/m) || [])[1] || "";
  const summary = { passed: 0, failed: 0, skipped: 0 };
  for (const match of line.matchAll(/(\d+)\s+(passed|failed|skipped|todo|pending)/g)) {
    const count = Number(match[1]);
    if (match[2] === "passed") summary.passed = count;
    else if (match[2] === "failed") summary.failed = count;
    else summary.skipped += count;
  }
  return summary;
}

// Run a git command inside the sample project; throws with stderr on failure.
function git(args) {
  const result = spawnSync("git", ["-C", SAMPLE_DIR, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return (result.stdout || "").trim();
}

// Make sure scenarios start from the healthy state so results are predictable.
function ensureCleanState() {
  try {
    git(["rev-parse", "--verify", "healthy"]); // the tag must exist
  } catch {
    throw new Error('the sample-project repo has no "healthy" tag — it should ship with one');
  }
  const status = git(["status", "--porcelain"]);
  if (status) {
    throw new Error(
      "sample-project has uncommitted changes — run scripts/scenarios/reset.js first\n" + status
    );
  }
}

// Replace the first occurrence of `from` with `to` in a sample-project file.
// Throws loudly when the anchor text is missing (never fail silently).
function replaceInFile(relPath, from, to) {
  const abs = path.join(SAMPLE_DIR, relPath);
  const content = fs.readFileSync(abs, "utf8");
  if (!content.includes(from)) {
    throw new Error(`anchor text not found in ${relPath}:\n  "${from}"`);
  }
  fs.writeFileSync(abs, content.replace(from, to));
}

// Commit every change in the sample project; returns the new commit sha.
function commitAll(message, authorName, authorEmail) {
  git(["add", "-A"]);
  const author = authorName ? ["--author", `${authorName} <${authorEmail}>`] : [];
  git(["commit", ...author, "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

// Restore the healthy state: hard reset to the healthy tag + rewrite .env
// (which is gitignored, so git alone cannot restore it). Idempotent.
function resetSampleProject() {
  git(["reset", "--hard", "healthy"]);
  fs.writeFileSync(
    path.join(SAMPLE_DIR, ".env"),
    "# Demo values for TraceBack scenarios (this file is gitignored on purpose).\n" +
      "# TraceBack stores only the NAMES of env vars, never these values.\n" +
      "DATABASE_URL=mongodb://demo-user:s3cretPass@cluster0.example.mongodb.net/shop\n" +
      "STRIPE_KEY=sk_test_51H7demoKq2xPlaceholder9fX\n"
  );
}

// Print a scenario verdict line: what was expected vs what actually happened.
function report(name, expectedText, ok, detail) {
  const verdict = ok ? "SCENARIO OK" : "SCENARIO MISMATCH";
  console.log(`\n[${name}] expected: ${expectedText}`);
  console.log(`[${name}] actual:   ${detail}`);
  console.log(`[${name}] ${verdict}`);
  return ok;
}

// Scenarios keep changes by default (run reset.js afterwards); --restore
// makes a scenario clean up after itself instead.
function shouldRestore() {
  return process.argv.includes("--restore");
}

module.exports = {
  SAMPLE_DIR,
  runJest,
  git,
  ensureCleanState,
  replaceInFile,
  commitAll,
  resetSampleProject,
  report,
  shouldRestore,
};
