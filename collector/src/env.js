// Environment variable handling.
//
// GOLDEN RULE: only NAMES ever leave this machine. Values are used for a
// presence check and immediately discarded — they are never put into the
// event, never logged, never written anywhere.

const fs = require("fs");
const path = require("path");

// Extract the NAMES defined in an .env-style file (no values).
function parseEnvNames(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const names = [];
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) names.push(match[1]);
  }
  return names;
}

// Names in the project's .env that have a non-empty value (presence only).
function parseEnvPresent(filePath) {
  const present = new Set();
  if (!fs.existsSync(filePath)) return present;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && match[2].trim() !== "") present.add(match[1]);
  }
  return present;
}

// requiredEnvKeys come from .env.example; envKeys = which of them are
// actually present (in .env or the real environment); missingEnvKeys = the rest.
function readEnvKeys(cwd) {
  const requiredEnvKeys = parseEnvNames(path.join(cwd, ".env.example"));
  const present = parseEnvPresent(path.join(cwd, ".env"));
  const envKeys = requiredEnvKeys.filter((key) => present.has(key) || process.env[key]);
  const missingEnvKeys = requiredEnvKeys.filter((key) => !envKeys.includes(key));
  return { requiredEnvKeys, envKeys, missingEnvKeys };
}

module.exports = { readEnvKeys };
