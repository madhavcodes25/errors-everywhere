// npm run setup:sample — (re)create the demo git repo inside sample-project.
//
// The GitHub repo ships the sample-project FILES, not its inner .git (a
// nested git repo would make clones of the parent lose all the files).
// This script rebuilds the inner repo a fresh clone needs for the demo:
//   git init -> one scaffold commit -> tag "healthy"
// It is IDEMPOTENT: if the repo and the tag already exist, it does nothing.
//
// The scenarios, collector and demo:reset all depend on this inner repo.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SAMPLE = path.join(__dirname, "..", "sample-project");

function git(args) {
  const res = spawnSync("git", ["-C", SAMPLE, ...args], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(res.stderr || "").trim()}`);
  }
  return (res.stdout || "").trim();
}

function run() {
  const gitDir = path.join(SAMPLE, ".git");
  const hasRepo = fs.existsSync(gitDir);
  const hasTag = hasRepo && git(["rev-parse", "--verify", "healthy"]).length > 0;
  if (hasRepo && hasTag) {
    console.log(`[setup:sample] demo repo already exists (tag "healthy" at ${git(["rev-parse", "--short", "healthy"])}). Nothing to do.`);
    return;
  }

  if (!hasRepo) {
    git(["init", "-b", "main"]);
    try {
      git(["config", "user.name", "Demo Developer"]);
      git(["config", "user.email", "demo@traceback.dev"]);
      git(["config", "core.autocrlf", "false"]);
    } catch {
      /* global config exists — fine */
    }
    console.log("[setup:sample] created sample-project/.git");
  }

  git(["add", "-A"]);
  git(["commit", "-m", "chore: scaffold shop-api with jest", "--no-verify"]);
  git(["tag", "-f", "healthy"]);
  console.log(`[setup:sample] demo repo ready — tag "healthy" at ${git(["rev-parse", "--short", "HEAD"])}`);
}

try {
  run();
} catch (err) {
  console.error("[setup:sample] failed:", err.message);
  process.exitCode = 1;
}
