// Maps test files to the source modules they exercise.
//
// Project convention (see the sample project): tests/X.test.js tests the
// module src/X.js. This matters for analysis: a commit that edits
// src/payment.js breaks tests/payment.test.js, so "which commit broke the
// tests?" has to correlate failing TEST files with changed SOURCE files.

// Normalize Windows separators first, then apply the naming convention.
// Returns the likely source files for a test file ([] when the name does
// not follow the convention).
function sourceFilesForTestFile(testFile) {
  const normalized = String(testFile || "").replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)tests?\/([^/]+)\.(?:test|spec)\.[cm]?[jt]sx?$/);
  if (!match) return [];
  return ["src/" + match[1] + ".js", "lib/" + match[1] + ".js"];
}

module.exports = { sourceFilesForTestFile };
