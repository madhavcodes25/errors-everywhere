// Every user-facing word lives here. Short, plain, active voice.
// Consistent words: always "run", "commit", "test".

export const app = {
  name: "Errors Everywhere",
  tagline: "Every run, recorded",
};

export const nav = {
  timeline: "Timeline",
  rejected: "Rejected events",
  project: "Project",
  themeLight: "Light theme",
  themeDark: "Dark theme",
};

export const connection = {
  live: "Live",
  connecting: "Connecting…",
  lost: "We lost connection. Trying again…",
};

export const timeline = {
  title: "Runs",
  search: "Filter runs ( / )",
  emptyTitle: "No runs yet. Send your first run.",
  loadSample: "Load sample data",
  erroredLabel: "Recorder crashed",
  newRunToast: (status, sha) => `New run ${status} on ${sha}`,
  duplicateToast: "Duplicate ignored — nothing changed",
  rejectedToast: (reason) => `Event rejected: ${reason}`,
  welcome: {
    title: "Welcome",
    steps: [
      { title: "Send your first run", body: "Each run is recorded forever." },
      { title: "See why it failed", body: "Plain answers, with the commits behind them." },
      { title: "Check release safety", body: "One look tells you if it's safe to ship." },
    ],
    skip: "Skip",
    sample: "Load sample data",
  },
};

export const release = {
  heading: "Release check",
  levels: {
    LOW: "Safe to release",
    MEDIUM: "Be careful",
    HIGH: "Not safe to release",
  },
  score: (score) => `${score} / 100`,
  blocked: "Blocked",
  seeWhy: "See why it failed",
  checklist: "Release checklist",
  basedOn: (runId) => runId,
};

export const runDetail = {
  back: "All runs",
  whyTitle: (sha) => `Why run ${sha} failed`,
  passedTitle: (sha) => `Run ${sha} passed`,
  testsOf: (failed, total) => `${failed} of ${total} tests failed`,
  allPassed: "All tests passed",
  erroredNote: "Recorder crashed — run incomplete",
  collectorErrorLabel: "The recorder itself failed",
  tabs: { why: "Why it failed", changes: "What changed", release: "Release check" },
  summaryButton: "Explain in plain English",
  summaryLoading: "Writing…",
  summaryUnavailable: "Summary unavailable",
  badgeLlm: "AI-written, checked against evidence",
  badgeTemplate: "Template",
};

export const verdicts = {
  new_regression: "New problem",
  new_regression_long: "New problem: this passed last time",
  flaky: "Flaky",
  flaky_long: "Fails sometimes, even on the same code",
  environment_problem: "Environment",
  environment_problem_long: "A setting or package is missing or changed",
  long_standing_break: "Long-standing",
  long_standing_break_long: "Has been failing for several runs",
  unknown: "We can't tell yet",
  unknown_long: "We can't tell yet",
};

export const confidence = {
  label: "Confidence",
  low: "low",
  medium: "medium",
  high: "high",
  lowNote: "We have little history, so this is a rough guess.",
};

export const culprits = {
  heading: "Culprit ranking",
  evidence: (n) => `Why we think this (${n} run${n === 1 ? "" : "s"})`,
  emptyPassed: "No failures in this run — nobody to blame.",
  emptyNoCommits: "No commits recorded since the last good run.",
  copyFix: "Copy this fix",
  copied: "Copied",
};

export const seenBefore = {
  heading: (n) => `Seen ${n} time${n === 1 ? "" : "s"} before`,
  lastSeen: (runId) => `Last failure: ${runId}`,
  fixedBy: (runId) => `Fixed in ${runId}`,
  copy: "Copy this fix",
  copied: "Copied",
};

export const changes = {
  heading: "What changed",
  oneLine: (commits, files) =>
    `${commits} commit${commits === 1 ? "" : "s"}, ${files} file${files === 1 ? "" : "s"} changed since the last good run`,
  noBaseline: "No earlier good run to compare with yet.",
  against: "Last good run",
  thisRun: "This run",
  commits: "Commits",
  files: "Files",
  dependencies: "Packages",
  major: "Major update",
  env: "Environment (names only)",
  tests: "Tests",
  newlyFailing: "Now failing",
  newlyPassing: "Fixed",
  muchSlower: "Much slower",
  duration: "Time",
  none: "None",
};

export const rejectedPage = {
  title: "Rejected events",
  emptyTitle: "Nothing was rejected.",
  fix: (reason) => {
    if (/projectId/i.test(reason)) return "Fix: add a projectId and send again.";
    if (/type/i.test(reason)) return "Fix: use \"run.completed\" or \"deploy.completed\".";
    return "Fix: check the event fields and send again.";
  },
};

export const errors = {
  unreachable: "We can't reach the server. Start it and try again.",
  generic: (message) => message || "Something went wrong.",
  retry: "Retry",
};

export const welcome = timeline.welcome;

export const tooltips = {
  confidence: "How much history this answer is based on: low (under 5 runs), medium (5–15), high (15+).",
  major: "The package's first version number jumped (for example 4 → 5). Big jumps often break things.",
};

// Aggregate default for components that import the whole dictionary.
const strings = {
  app, nav, connection, timeline, release, runDetail, verdicts, confidence,
  culprits, seenBefore, changes, rejectedPage, errors, welcome, tooltips,
};
export default strings;
