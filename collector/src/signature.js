// Error signatures + secret redaction for the collector.
//
// The signature algorithm is part of the TraceBack contract:
//   lowercase · quoted strings -> S · hex strings and UUIDs -> H ·
//   file paths -> PATH · numbers -> N · collapse whitespace · sha1
// Two failures with the same root cause produce the same signature, even
// when the exact numbers/paths differ.
//
// KEEP IN SYNC with server/src/lib/signature.js (same algorithm there).

const crypto = require("crypto");

// Redact anything that looks like a secret BEFORE it is stored or signed.
// Values are never stored anywhere — only [REDACTED] placeholders.
const TEXT_PATTERNS = [
  // Credentials inside connection strings: mongodb://user:pass@host
  [/mongodb(\+srv)?:\/\/[^:\s/@]+:[^@\s/]+@/gi, "mongodb$1://***:***@"],
  // Known token prefixes (Stripe-style, GitHub, AWS).
  [/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{12,})\b/g, "[REDACTED]"],
  // Bearer tokens in headers.
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]"],
  // key=value or "key": "value" style leaks.
  [/(password|passwd|secret|token|api[-_]?key|apikey|authorization)["']?\s*[:=]\s*["']?[^\s"',;]+/gi, "$1=[REDACTED]"],
  // Very long hex/base64 blobs (>= 48 chars) — almost always keys.
  [/[A-Za-z0-9+/\-_]{48,}/g, "[REDACTED]"],
];

// Scrub secrets from one free-text string (error messages, collector errors).
function redactText(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// The contract's signature algorithm.
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

module.exports = { redactText, errorSignature };
