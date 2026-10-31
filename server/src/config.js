// Configuration for the Errors Everywhere server.
// Values come from environment variables; server/.env is loaded first as a
// convenience (hand-rolled so we avoid an extra dependency).

const fs = require("fs");
const path = require("path");

// Load server/.env if present. Real environment variables always win.
function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}
loadEnvFile();

const config = {
  // Port the Express API listens on.
  port: Number(process.env.PORT || 4000),
  // MongoDB connection string. Empty string = use the in-memory dev database.
  mongoUri: (process.env.MONGODB_URI || "").trim(),
  // Database name inside MongoDB.
  dbName: process.env.DATABASE_NAME || "errors-everywhere",
  // LLM summary (Part 7). The app works FULLY with this off: rules and
  // MongoDB do the detective work, the LLM only rephrases verified evidence.
  llm: {
    // Summary uses the LLM only when enabled AND a key is present.
    enabled: process.env.LLM_ENABLED === "true",
    // Swappable provider: "openai" (any /chat/completions-compatible API)
    // or "anthropic". The call lives in ONE small function (summarize.js).
    provider: process.env.MODEL_PROVIDER || "openai",
    model: process.env.MODEL_NAME || "gpt-4o-mini",
    apiKey: process.env.API_KEY || "",
    baseUrl: (process.env.MODEL_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  },
};

module.exports = config;
