// Unit tests for the culprit scorer — PURE functions, hand-built data where
// the correct answer is known by construction. Run with: npm test (in server/)

const { scoreCandidates, SMOOTHING, MIN_FILE_SAMPLE, PATH_BONUS } = require("./culprits");

describe("culprit scoring (pure, hand-built data)", () => {
  // Hand-built history with a KNOWN answer:
  //   10 earlier runs; "payment charges card" failed in 5 of them
  //   (failOverall = 0.5);
  //   src/payment.js changed in 6 runs, and the test failed in 5 of those 6
  //   -> failGivenChanged = 0.833
  //   -> lift = (0.833 + 0.05) / (0.5 + 0.05) = 1.606
  //   -> contribution max(0, 1.606 - 1) = 0.606, plus +1.0 path bonus
  //      (src/payment.js <-> tests/payment.test.js) = 1.606 total.
  //   README.md changed in 6 runs but never correlated -> contribution 0.
  //   src/cart.js changed in only 2 runs, never correlated -> lift sample ok
  //   but (0 + 0.05) / 0.55 = 0.0909 < 1 -> contribution 0.
  const stats = {
    totalRuns: 10,
    testStats: { "payment charges card": { fails: 5, runIds: [] } },
    fileStats: {
      "src/payment.js": { changed: 6, runIds: [] },
      "README.md": { changed: 6, runIds: [] },
      "src/cart.js": { changed: 2, runIds: [] },
    },
    coStats: { "payment charges card": { "src/payment.js": { co: 5, runIds: [] } } },
  };
  const failedTests = [{ name: "payment charges card", file: "tests/payment.test.js" }];
  const commits = [
    { sha: "a".repeat(40), message: "docs: update README", author: "Alice", files: ["README.md"] },
    { sha: "b".repeat(40), message: "refactor: cart helpers", author: "Bob", files: ["src/cart.js"] },
    { sha: "c".repeat(40), message: "fix: fee", author: "Carol", files: ["src/payment.js"] },
  ];

  test("the guilty commit ranks 1 with 100%; README and cart score 0", () => {
    const { candidates, allZero } = scoreCandidates(commits, failedTests, stats);
    expect(allZero).toBe(false);
    expect(candidates[0].rank).toBe(1);
    expect(candidates[0].sha).toBe("c".repeat(40));
    expect(candidates[0].matchPercent).toBe(100);
    const readme = candidates.find((c) => c.files.includes("README.md"));
    expect(readme.matchPercent).toBe(0);
    const cart = candidates.find((c) => c.files.includes("src/cart.js"));
    expect(cart.matchPercent).toBe(0);
    expect(candidates[0].reasons.join(" ")).toContain("5 of 6 past runs");
    // smoothing sanity: lift is exactly (5/6 + a) / (1/2 + a)
    const expectedLift = (5 / 6 + SMOOTHING) / (5 / 10 + SMOOTHING);
    expect(expectedLift).toBeCloseTo(1.606, 2);
  });

  test("files with fewer than 2 past samples stay neutral (lift = 1)", () => {
    const tinyStats = {
      totalRuns: 4,
      testStats: { T: { fails: 2, runIds: [] } },
      fileStats: { "src/new.js": { changed: 1, runIds: [] } },
      coStats: { T: { "src/new.js": { co: 1, runIds: [] } } },
    };
    // no path match either (test lives in tests/other.test.js)
    const { candidates, allZero } = scoreCandidates(
      [{ sha: "d".repeat(40), message: "feat: new", author: "Dan", files: ["src/new.js"] }],
      [{ name: "T", file: "tests/other.test.js" }],
      tinyStats
    );
    expect(allZero).toBe(true); // neutral lift + no path bonus -> zero score
    expect(candidates[0].matchPercent).toBe(100); // equal share of one candidate
  });

  test("two suspicious commits normalize to percentages summing to 100", () => {
    const twoStats = {
      totalRuns: 10,
      testStats: { T: { fails: 5, runIds: [] } },
      fileStats: {
        "src/payment.js": { changed: 6, runIds: [] },
        "src/auth.js": { changed: 4, runIds: [] },
      },
      coStats: {
        T: {
          "src/payment.js": { co: 5, runIds: [] },
          "src/auth.js": { co: 3, runIds: [] },
        },
      },
    };
    const { candidates } = scoreCandidates(
      [
        { sha: "e".repeat(40), message: "payment change", author: "A", files: ["src/payment.js"] },
        { sha: "f".repeat(40), message: "auth change", author: "B", files: ["src/auth.js"] },
      ],
      [{ name: "T", file: "tests/other.test.js" }],
      twoStats
    );
    const sum = candidates.reduce((s, c) => s + c.matchPercent, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.2);
    // payment has the stronger correlation (0.606 vs 0.455 contribution)
    expect(candidates[0].files).toEqual(["src/payment.js"]);
    expect(candidates[0].matchPercent).toBeGreaterThan(candidates[1].matchPercent);
  });

  test("empty candidate list stays empty", () => {
    const { candidates, allZero } = scoreCandidates([], failedTests, stats);
    expect(candidates).toEqual([]);
    expect(allZero).toBe(false);
  });
});
