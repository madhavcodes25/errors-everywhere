// Confidence labels.
//
// Contract (Part 4): show a confidence label based on how much history
// exists, and NEVER fake certainty:
//   low    — fewer than 5 prior runs
//   medium — 5 to 15 prior runs
//   high   — more than 15 prior runs
// Every analysis response includes one; per-test labels use the test's own
// history size, top-level labels use the project's prior run count.

// How many earlier runs did we look at?
function confidenceFromRunCount(priorRunCount) {
  if (priorRunCount > 15) return "high";
  if (priorRunCount >= 5) return "medium";
  return "low";
}

// Return the weaker of two labels when a condition weakens confidence.
function downgradeConfidence(current, condition, floor = "low") {
  if (!condition) return current;
  const ORDER = { low: 0, medium: 1, high: 2 };
  return ORDER[floor] < ORDER[current] ? floor : current;
}

module.exports = { confidenceFromRunCount, downgradeConfidence };
