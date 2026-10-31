// Error signatures.
//
// The SAME bug produces slightly different error text on every run (numbers,
// paths, timings differ). The signature normalizes the message and hashes it,
// so "seen this failure before?" becomes a simple string comparison across
// runs. Algorithm (part of the TraceBack contract):
//   lowercase · quoted strings -> S · hex strings and UUIDs -> H ·
//   file paths -> PATH · numbers -> N · collapse whitespace · sha1
//
// This is also the FALLBACK for events whose collector did not compute a
// signature. KEEP IN SYNC with collector/src/signature.js.

const crypto = require("crypto");

function errorSignature(message) {
  let s = String(message ?? "");
  s = s
    .toLowerCase()
    // quoted strings first, so numbers/paths inside quotes become S
    .replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, "S")
    // UUIDs, then generic hex strings (commit SHAs, hashes, ...)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "H")
    .replace(/\b[0-9a-f]{8,}\b/g, "H")
    // file paths and URLs (windows drives, unix paths)
    .replace(/(?:[a-z]:)?(?:[\\/][^\s'":;|,)]+)+/g, "PATH")
    // numbers last
    .replace(/\d+(?:\.\d+)?/g, "N")
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha1").update(s).digest("hex");
}

module.exports = { errorSignature };
