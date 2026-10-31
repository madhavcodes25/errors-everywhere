// Run Jest in the target project and parse the JSON results into the
// contract's tests[] shape.
//
// IMPORTANT: jest exiting non-zero because TESTS FAILED is NORMAL, not a
// collector crash. We only treat "no JSON results at all" as a crash
// (config broken, jest cannot start, out of memory, ...).

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { redactText, errorSignature } = require("./signature");

// Prefer the project's local jest binary (no shell-quoting issues on
// Windows); fall back to npx for projects that have not installed jest.
function resolveJestCommand(cwd) {
  const localJest = path.join(cwd, "node_modules", "jest", "bin", "jest.js");
  if (fs.existsSync(localJest)) {
    return { cmd: process.execPath, args: [localJest] };
  }
  return { cmd: "npx", args: ["jest"], shell: process.platform === "win32" };
}

// Jest failure messages are multi-line: a "● <test name>" header, the actual
// error message, then a code frame and stack trace. We only want the core
// error message so the signature matches across machines.
function extractErrorMessage(failureMessage) {
  const lines = String(failureMessage || "").split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    if (text.startsWith("●")) continue; // test-name headers (possibly nested)
    if (/^\d+\s*\|/.test(text)) break; // code frame starts
    if (text.startsWith("at ")) break; // stack trace starts
    kept.push(text);
  }
  let message = kept.join(" ").trim();
  // Jest prefixes thrown errors with "Error: " — the seeded history and the
  // sample project's own messages do not, so strip it for stable signatures.
  message = message.replace(/^error:\s*/i, "");
  // Fallback: first non-empty line of the raw message.
  return message || String(failureMessage || "").split("\n").map((l) => l.trim()).filter(Boolean)[0] || "no error message captured";
}

// Jest reports "pending"/"todo"; the contract enum is passed|failed|skipped.
function mapStatus(status) {
  if (status === "passed" || status === "failed") return status;
  return "skipped";
}

// Run jest and parse results. Throws Error (with .detail) when jest produced
// no JSON results at all — that becomes a status "errored" run upstream.
function runJest(cwd) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceback-jest-"));
  const outputFile = path.join(tmpDir, "jest-results.json");
  const jest = resolveJestCommand(cwd);

  const result = spawnSync(jest.cmd, [...jest.args, "--json", `--outputFile=${outputFile}`], {
    cwd,
    encoding: "utf8",
    shell: jest.shell || false,
    timeout: 10 * 60 * 1000, // hard cap; a hung suite cannot hang the collector forever
  });

  let json = null;
  try {
    json = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  } catch {
    /* no results file -> treated as a crash below */
  }

  if (!json || !Array.isArray(json.testResults)) {
    const tail = ((result.stderr || "") + (result.stdout || ""))
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-4)
      .join(" | ");
    const reason = result.error ? result.error.message : `jest exited with code ${result.status}`;
    const error = new Error(`jest produced no results (${reason})`);
    error.detail = redactText(tail || "no output captured");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }

  // Map jest's assertionResults into the contract's tests[] entries.
  const tests = [];
  for (const suite of json.testResults) {
    // The serialized jest JSON stores the test file path under `name`
    // (testFilePath only exists on the internal object). Store files relative
    // to the project with forward slashes, matching what commits[] and the
    // seeded history use (e.g. tests/payment.test.js).
    const suitePath = suite.name || suite.testFilePath || "";
    const file = path.relative(cwd, suitePath).replace(/\\/g, "/");
    for (const assertion of suite.assertionResults || []) {
      const test = {
        name: assertion.fullName || assertion.title || "unnamed test",
        file,
        status: mapStatus(assertion.status),
        durationMs: typeof assertion.duration === "number" ? assertion.duration : 0,
      };
      if (test.status === "failed") {
        // Redact secrets BEFORE storing or signing the message.
        const message = redactText(extractErrorMessage((assertion.failureMessages || [])[0]));
        test.error = { message, signature: errorSignature(message) };
      }
      tests.push(test);
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  const failed = tests.filter((t) => t.status === "failed").length;
  const passed = tests.filter((t) => t.status === "passed").length;
  return { status: failed > 0 ? "failed" : "passed", tests, passed, failed };
}

module.exports = { runJest, extractErrorMessage };
