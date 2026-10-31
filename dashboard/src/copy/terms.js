// Glossary — the consistent words this product uses. If a screen ever needs
// a technical term, it links here with a one-sentence "What's this?" tooltip.

export const terms = {
  run: {
    term: "Run",
    plain: "One trip of your tests — it either passed, failed, or the recorder itself crashed.",
  },
  commit: {
    term: "Commit",
    plain: "A saved change to the code, with its own short ID (the SHA).",
  },
  test: {
    term: "Test",
    plain: "A small check that the code behaves the way it should.",
  },
  lastGoodRun: {
    term: "Last good run",
    plain: "The most recent run where every test passed. Comparisons start here.",
  },
  verdict: {
    term: "Verdict",
    plain: "The plain-language reason a test failed, chosen from recorded history.",
  },
  confidence: {
    term: "Confidence",
    plain: "How much recorded history the answer is based on: low, medium, or high.",
  },
  culprit: {
    term: "Culprit",
    plain: "The commit most likely to have broken the run, ranked from history.",
  },
};

export default terms;
