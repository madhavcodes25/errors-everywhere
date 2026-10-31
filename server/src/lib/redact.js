// Secret redaction.
//
// Golden rule from the spec: store environment variable NAMES only, never
// values, and redact anything that looks like a secret (keys, tokens,
// passwords) from error messages and logs.
//
// We apply redactText() ONLY to free-text fields (error messages, collector
// errors, commit messages, log-ish strings) so structured data like commit
// SHAs — which never looks like a credential anyway — is left alone.

// Key names whose VALUES are always secrets (matched case-insensitively).
// Deliberately does NOT match "author" or "envKeys".
const SECRET_KEY = /(password|passwd|secret|token|api[-_]?key|apikey|credential|private[-_]?key|authorization)/i;

// Key names whose string values are "free text" and get redactText() applied.
const FREE_TEXT_KEY = /(message|error|log|output|text|reason|stdout|stderr)/i;

// Patterns that scrub secrets out of free text.
const TEXT_PATTERNS = [
  // Credentials inside connection strings: mongodb://user:pass@host
  [/mongodb(\+srv)?:\/\/[^:\s/@]+:[^@\s/]+@/gi, "mongodb$1://***:***@"],
  // Known token prefixes (Stripe-style, GitHub, AWS).
  [/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{12,})\b/g, "[REDACTED]"],
  // Bearer tokens in headers.
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]"],
  // key=value or "key": "value" style leaks.
  [/(password|passwd|secret|token|api[-_]?key|apikey|authorization)["']?\s*[:=]\s*["']?[^\s"',;]+/gi, "$1=[REDACTED]"],
  // Very long hex/base64 blobs (>= 48 chars) — almost always keys, never SHAs
  // we care about (git SHAs are 40 hex chars and live in structured fields).
  [/[A-Za-z0-9+/\-_]{48,}/g, "[REDACTED]"],
];

// Scrub secrets from one free-text string.
function redactText(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Recursively scrub an object/array:
//  - values under secret-looking keys   -> "[REDACTED]"
//  - strings under free-text keys       -> redactText()
// Returns { value, changed } so callers can flag that redaction happened.
function redactDeep(input) {
  let changed = false;

  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const [key, val] of Object.entries(node)) {
        if (SECRET_KEY.test(key) && val !== null && val !== undefined) {
          out[key] = "[REDACTED]";
          changed = true;
        } else if (typeof val === "string" && FREE_TEXT_KEY.test(key)) {
          const cleaned = redactText(val);
          if (cleaned !== val) changed = true;
          out[key] = cleaned;
        } else {
          out[key] = walk(val);
        }
      }
      return out;
    }
    if (typeof node === "string") {
      // Bare strings inside plain arrays (e.g. raw log lines) get light scrubbing
      // only if they clearly contain a secret marker.
      const cleaned = /password|token|secret|api[-_]?key|Bearer |sk-|mongodb+:\/\//i.test(node)
        ? redactText(node)
        : node;
      if (cleaned !== node) changed = true;
      return cleaned;
    }
    return node;
  };

  return { value: walk(input), changed };
}

module.exports = { redactText, redactDeep };
