// Authentication helpers built on node:crypto (no external deps needed):
// signed, expiring tokens and salted password hashes.

const crypto = require("crypto");

// Demo signing secret. A real service would load this from the environment;
// keep it simple here — the interesting part is the token shape.
const SIGNING_SECRET = "demo-signing-secret";

// Issue a token for a user, valid for ttlMs (default 1 hour).
function createToken(user, { ttlMs = 60 * 60 * 1000 } = {}) {
  const payload = { user, expiresAt: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

// Verify a token; throws on tampering or expiry, returns the payload.
function verifyToken(token) {
  const [body, signature] = String(token).split(".");
  const expected = crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(body)
    .digest("base64url");
  if (signature !== expected) throw new Error("invalid token signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (Date.now() > payload.expiresAt) throw new Error("token expired");
  return payload;
}

// Salted scrypt hash — the salt is unique per password, so identical
// passwords produce different hashes.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return { salt, hash };
}

module.exports = { createToken, verifyToken, hashPassword };
