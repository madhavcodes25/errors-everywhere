// Realistic sample data shaped EXACTLY like the real server's responses
// (same field names, same shapes). Flip the data source in src/config/index.js
// or press "Load sample data" in the app to use these.

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();

const SHAS = {
  culprit: "9f3c2e1a44d1c7b2e5f601a3bb8c4d7e2f9a0b1c",
  cart: "b4d2e6f80a1c3e5d7092b4c6d8e0f2a4b6c8d0e2",
  readme: "c5e3f709b1d2e4f6081a3b5c7d9e1f3a5b7c9d1e",
  baseline: "6fe35758aa22ccb1e4f33d5a7b9c1e3f5a7b9c1d",
  fixPast: "6bc7a6b5d4e3f2a1908172635445362718f9e0d1",
};

const ALL_TESTS = [
  { name: "adds a new item to the cart", file: "tests/cart.test.js", status: "passed", durationMs: 38 },
  { name: "merges quantities when the same sku is added twice", file: "tests/cart.test.js", status: "passed", durationMs: 31 },
  { name: "removes an item from the cart", file: "tests/cart.test.js", status: "passed", durationMs: 27 },
  { name: "throws when removing an unknown sku", file: "tests/cart.test.js", status: "passed", durationMs: 22 },
  { name: "applies a percentage discount with correct rounding", file: "tests/discount.test.js", status: "passed", durationMs: 41 },
  { name: "rejects discount percentages outside 0-100", file: "tests/discount.test.js", status: "passed", durationMs: 18 },
  { name: "applies tier discounts for larger carts", file: "tests/discount.test.js", status: "passed", durationMs: 33 },
  {
    name: "payment charges card", file: "tests/payment.test.js", status: "failed", durationMs: 118,
    error: { message: "payment charges card: expected charge 102.9 but got 100", signature: "b0ec42965d19867b5eb3f1dbf1914b57e8246085" },
  },
  { name: "payment rejects invalid amounts", file: "tests/payment.test.js", status: "passed", durationMs: 19 },
  { name: "payment requires STRIPE_KEY to be configured", file: "tests/payment.test.js", status: "passed", durationMs: 14 },
  { name: "payment refunds a charge", file: "tests/payment.test.js", status: "passed", durationMs: 55 },
  { name: "auth issues and verifies a token", file: "tests/auth.test.js", status: "passed", durationMs: 74 },
  { name: "auth rejects an expired token", file: "tests/auth.test.js", status: "passed", durationMs: 28 },
  { name: "auth hashes passwords with a unique salt", file: "tests/auth.test.js", status: "passed", durationMs: 84 },
];

const DEPS = [
  { name: "express", version: "^4.21.2" },
  { name: "stripe", version: "^14.0.0" },
  { name: "lodash", version: "^4.17.21" },
];
const ENV = ["DATABASE_URL", "STRIPE_KEY"];

function testsWith(failedNames) {
  return ALL_TESTS.map((t) =>
    failedNames.includes(t.name)
      ? { ...t, status: "failed", error: t.error }
      : { ...t }
  );
}

export const mockRuns = [
  {
    _id: "run_9f3c2e1a0112", projectId: "shop-api", commitSha: SHAS.culprit, branch: "main",
    author: "Marcus Webb", startedAt: iso(2), finishedAt: iso(2), durationMs: 3140, status: "failed",
    commits: [
      { sha: SHAS.readme, message: "docs: document checkout fees", author: "Alice Chen", files: ["README.md"] },
      { sha: SHAS.cart, message: "refactor: clarify cart item shape", author: "Diego Ruiz", files: ["src/cart.js"] },
      { sha: SHAS.culprit, message: "fix: apply fee after tax in checkout", author: "Marcus Webb", files: ["src/payment.js"] },
    ],
    changedFiles: ["README.md", "src/cart.js", "src/payment.js"],
    dependencies: DEPS, envKeys: ENV, missingEnvKeys: [],
    tests: testsWith(["payment charges card"]),
  },
  {
    _id: "run_6fe35758aa33", projectId: "shop-api", commitSha: SHAS.baseline, branch: "main",
    author: "Marcus Webb", startedAt: iso(6), finishedAt: iso(6), durationMs: 1620, status: "passed",
    commits: [{ sha: SHAS.baseline, message: "chore: tidy cart module", author: "Marcus Webb", files: ["src/cart.js"] }],
    changedFiles: ["src/cart.js"], dependencies: DEPS, envKeys: ENV, missingEnvKeys: [],
    tests: ALL_TESTS,
  },
  {
    _id: "run_43387541c247", projectId: "shop-api", commitSha: "e11438e9aabb00112233445566778899aabbccdd",
    branch: "main", author: "Priya Nair", startedAt: iso(14), finishedAt: iso(14), durationMs: 460,
    status: "errored",
    commits: [{ sha: "e11438e9aabb00112233445566778899aabbccdd", message: "feat: remember me sessions", author: "Priya Nair", files: ["src/auth.js"] }],
    changedFiles: ["src/auth.js"], dependencies: DEPS, envKeys: ENV, missingEnvKeys: [],
    tests: [],
    collectorError: "Jest worker ran out of memory: JavaScript heap out of memory — no test results were reported",
  },
  {
    _id: "run_59019d6fedcba", projectId: "shop-api", commitSha: "59019d6fedcba9876543210abcdef0123456789",
    branch: "main", author: "Alice Chen", startedAt: iso(22), finishedAt: iso(22), durationMs: 2980,
    status: "failed",
    commits: [{ sha: "59019d6fedcba9876543210abcdef0123456789", message: "fix: fee edge cases in checkout", author: "Alice Chen", files: ["src/payment.js"] }],
    changedFiles: ["src/payment.js"], dependencies: DEPS, envKeys: ENV, missingEnvKeys: [],
    tests: testsWith(["payment charges card"]),
  },
  {
    _id: "run_107e734priya", projectId: "shop-api", commitSha: "107e7345566778899aabbccddeeff0011223344",
    branch: "main", author: "Priya Nair", startedAt: iso(30), finishedAt: iso(30), durationMs: 1890,
    status: "passed",
    commits: [{ sha: "107e7345566778899aabbccddeeff0011223344", message: "feat: session revocation", author: "Priya Nair", files: ["src/auth.js"] }],
    changedFiles: ["src/auth.js"], dependencies: DEPS, envKeys: ENV, missingEnvKeys: [],
    tests: ALL_TESTS,
  },
];

export const mockDiagnosis = {
  runId: "run_9f3c2e1a0112",
  status: "failed",
  confidence: "high",
  note: "Most likely culprit: 9f3c2e1 \"fix: apply fee after tax in checkout\" (74% of the evidence).",
  tests: [
    {
      name: "payment charges card",
      file: "tests/payment.test.js",
      verdict: "new_regression",
      confidence: "high",
      explanation:
        "\"payment charges card\" passed in the previous run (run_6fe35758aa33) and fails now — something in between broke it. Seen 6 time(s) before; the first later passing run (run_6fe35758aa33) contained commit(s) 6fe3575 touching src/cart.js.",
      evidence: {
        history: mockRuns.slice(1, 5).map((r) => ({
          runId: r._id, commitSha: r.commitSha, status: r.status, startedAt: r.startedAt,
          durationMs: 100, envKeys: ENV,
        })),
        fileRiskRates: { "src/payment.js": { runs: 12, failures: 8, failRate: 0.667 } },
        seenBefore: {
          count: 6,
          lastSeenRunId: "run_59019d6fedcba",
          fixedBy: { runId: "run_6fe35758aa33", commits: [{ sha: SHAS.baseline, message: "chore: tidy cart module" }], files: ["src/cart.js"] },
        },
      },
    },
  ],
};

export const mockCulprits = {
  runId: "run_9f3c2e1a0112",
  status: "failed",
  confidence: "high",
  baselineRunId: "run_6fe35758aa33",
  candidates: [
    {
      rank: 1, sha: SHAS.culprit, message: "fix: apply fee after tax in checkout", author: "Marcus Webb",
      files: ["src/payment.js"], matchPercent: 74,
      reasons: [
        "src/payment.js changes preceded \"payment charges card\" failures in 6 of 12 past runs",
        "src/payment.js matches the failing test's module (tests/payment.test.js)",
      ],
      evidenceRunIds: ["run_59019d6fedcba", "run_107e734priya", "run_43387541c247"],
    },
    {
      rank: 2, sha: SHAS.cart, message: "refactor: clarify cart item shape", author: "Diego Ruiz",
      files: ["src/cart.js"], matchPercent: 16,
      reasons: ["src/cart.js changes preceded \"payment charges card\" failures in 1 of 4 past runs"],
      evidenceRunIds: ["run_107e734priya"],
    },
    {
      rank: 3, sha: SHAS.readme, message: "docs: document checkout fees", author: "Alice Chen",
      files: ["README.md"], matchPercent: 10,
      reasons: ["most recent change before the failure"],
      evidenceRunIds: [],
    },
  ],
  note: null,
};

export const mockChanges = {
  runId: "run_9f3c2e1a0112",
  againstRunId: "run_6fe35758aa33",
  againstIsLastGood: true,
  commits: mockRuns[0].commits,
  changedFiles: ["README.md", "src/cart.js", "src/payment.js"],
  dependencies: { added: [], removed: [], changed: [] },
  config: { envKeys: { added: [], removed: [] }, missingEnvKeys: { introduced: [], resolved: [] } },
  tests: { newlyFailing: ["payment charges card"], newlyPassing: [], stillFailing: [], muchSlower: [] },
  duration: { previousMs: 1620, currentMs: 3140, deltaMs: 1520 },
  evidence: { runIds: ["run_6fe35758aa33", "run_9f3c2e1a0112"], fromCommit: SHAS.baseline, toCommit: SHAS.culprit },
  confidence: "high",
};

export function mockRelease(projectId, runId) {
  if (runId && runId !== "run_9f3c2e1a0112") {
    return {
      projectId, runId, branch: "main", asOf: new Date().toISOString(),
      score: 0, level: "LOW", blocked: false, reasons: [],
      recommendation: "No build-health risks found (score 0/100). Safe to release from Errors Everywhere's point of view.",
      confidence: "high",
    };
  }
  return {
    projectId, runId: "run_9f3c2e1a0112", branch: "main", asOf: new Date().toISOString(),
    score: 90, level: "HIGH", blocked: true,
    reasons: [
      { points: 50, text: "Latest run run_9f3c2e1a0112 did not pass (status \"failed\", commit 9f3c2e1)" },
      { points: 10, text: "1 test(s) currently failing: \"payment charges card\"" },
      { points: 10, text: "Unfixed high-suspicion commit: 9f3c2e1 \"fix: apply fee after tax in checkout\" (74% match)" },
      { points: 15, text: "High-risk changed file(s): src/payment.js (67% failure rate over 12 runs)" },
      { points: 5, text: "Flaky test(s) in the touched area: \"refund works\"" },
    ],
    recommendation: "Do not release yet. Top issue: the latest run failed. Fix it, land a green run, then re-check.",
    confidence: "high",
  };
}

export const mockRejected = {
  count: 1,
  events: [
    {
      receivedAt: iso(3),
      reason: "Missing required field: projectId",
      rawBody: { type: "run.completed", payload: { commitSha: "bad0000000000000000000000000000000000001", tests: [] } },
    },
  ],
};
