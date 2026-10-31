// Jest setup: load .env (if present) into process.env.
// Hand-written (no dotenv dependency) to keep the sample project dependency-light.
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && process.env[match[1]] === undefined) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      process.env[match[1]] = value;
    }
  }
}
