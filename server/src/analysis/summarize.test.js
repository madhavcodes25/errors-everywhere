// Unit tests for the Part 7 summary layer — the safety check (a fake LLM
// response with invented facts must be rejected) and the LLM path with a
// MOCK provider (invented file -> template fallback; honest text -> used).
// Run with: npm test (in server/)

const http = require("http");
const { verifyLlmText, tryLlmSummary, templateFromEvidence } = require("./summarize");
const config = require("../config");

// Hand-built evidence with a KNOWN allowed set of facts.
const evidence = {
  runId: "run_0123456789ab",
  projectId: "shop-api",
  status: "failed",
  branch: "main",
  commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  tests: { total: 14, failed: 1, passed: 13 },
  failedTests: [
    {
      name: "payment charges card",
      file: "tests/payment.test.js",
      verdict: "new_regression",
      confidence: "high",
      seenBefore: { count: 6, lastSeenRunId: "run_0123456789ab", fixedByRunId: null, fixedByFiles: [] },
    },
  ],
  changedFiles: ["src/payment.js"],
  suspectCommits: [{ sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", message: "fix: fee", author: "Marcus", files: ["src/payment.js"] }],
  baseline: { runId: "run_feedface0001", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  dependencies: { added: [], removed: [], changed: [{ name: "express", from: "^4.21.2", to: "^5.1.0", major: true }] },
  topCulprit: {
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    message: "fix: fee",
    author: "Marcus",
    matchPercent: 100,
    reasons: ["changed file(s) exercised by failing tests: src/payment.js"],
  },
  culpritsConfidence: "high",
  release: { score: 100, level: "HIGH", blocked: true, reasons: [{ points: 50, text: "Latest run failed" }], recommendation: "Do not release yet." },
};

describe("LLM output safety check", () => {
  test("an honest summary built only from evidence facts passes", () => {
    const text =
      'Run run_0123456789ab failed: "payment charges card" is a new regression. ' +
      "Most likely culprit aaaaaaa \"fix: fee\" with 100% confidence high. " +
      "Suggested next action: revert commit aaaaaaa and re-run.";
    expect(verifyLlmText(text, evidence)).toEqual({ ok: true });
  });

  test("a fake response with an INVENTED FILE NAME is rejected", () => {
    const text = "The failure comes from src/inventory.js which was changed recently.";
    const result = verifyLlmText(text, evidence);
    expect(result.ok).toBe(false);
    expect(result.claim).toContain("inventory");
  });

  test("a fake response with an INVENTED NUMBER is rejected", () => {
    const text = "Run run_0123456789ab failed with 7 failing tests.";
    const result = verifyLlmText(text, evidence); // evidence says 1 failed test
    expect(result.ok).toBe(false);
    expect(result.claim).toBe("7");
  });

  test("an INVENTED COMMIT SHA is rejected", () => {
    const text = "Culprit commit deadbee is most likely responsible.";
    const result = verifyLlmText(text, evidence);
    expect(result.ok).toBe(false);
  });

  test("an INVENTED RUN ID is rejected", () => {
    const text = "Seen before in run_deadbeef0001.";
    const result = verifyLlmText(text, evidence);
    expect(result.ok).toBe(false);
  });
});

describe("template fallback (LLM off)", () => {
  test("templateFromEvidence mentions run, culprit and confidence", () => {
    const text = templateFromEvidence(evidence);
    expect(text).toContain("run_0123456789ab");
    expect(text).toContain("aaaaaaa");
    expect(text).toContain("100% of the evidence");
    expect(text).toContain("Confidence: high");
  });
});

describe("LLM path with a MOCK provider", () => {
  afterEach(() => {
    // restore the real config after each mock test
    config.llm.enabled = false;
    config.llm.apiKey = "";
    config.llm.baseUrl = "https://api.openai.com/v1";
  });

  function startMockServer(respond) {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(respond(body)));
        });
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
  }

  test("an LLM response with an invented file falls back to the template", async () => {
    const server = await startMockServer(() => ({
      choices: [{ message: { content: "Check src/inventory.js for the root cause of this failure." } }],
    }));
    const { port } = server.address();
    config.llm.enabled = true;
    config.llm.apiKey = "test-key-not-a-secret";
    config.llm.baseUrl = `http://127.0.0.1:${port}`;

    const result = await tryLlmSummary(evidence);
    expect(result).toBeNull(); // rejected -> caller uses the template
    server.close();
  });

  test("an honest LLM response is used (source would be llm)", async () => {
    const server = await startMockServer(() => ({
      choices: [{ message: { content: 'Run run_0123456789ab failed on "payment charges card". Culprit aaaaaaa (100%). Next: revert it.' } }],
    }));
    const { port } = server.address();
    config.llm.enabled = true;
    config.llm.apiKey = "test-key-not-a-secret";
    config.llm.baseUrl = `http://127.0.0.1:${port}`;

    const result = await tryLlmSummary(evidence);
    expect(result).not.toBeNull();
    expect(result.text).toContain("run_0123456789ab");
    server.close();
  });

  test("a provider that is DOWN falls back to null (template) without throwing", async () => {
    config.llm.enabled = true;
    config.llm.apiKey = "test-key-not-a-secret";
    config.llm.baseUrl = "http://127.0.0.1:9"; // nothing listens there
    const result = await tryLlmSummary(evidence);
    expect(result).toBeNull();
  });
});
