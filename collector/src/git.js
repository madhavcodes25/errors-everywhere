// Read everything the collector needs from git:
//   commitSha, branch, author + the commits[] array since the last recorded
//   run (previous sha comes from .traceback/state.json; first run falls back
//   to the last 5 commits), and changedFiles as the union of all commit files.

const { spawnSync } = require("child_process");

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || "unknown error").trim()}`);
  }
  return (result.stdout || "").trim();
}

// Parse `git log --name-only --pretty=format:--C--%H|%an|%s` output into
// [{ sha, author, message, files }].
function parseCommitBlocks(output) {
  const commits = [];
  for (const block of String(output).split("--C--")) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const parts = lines[0].split("|");
    commits.push({
      sha: parts[0] || "",
      author: parts[1] || "unknown",
      message: parts.slice(2).join("|") || "", // subjects may contain "|"
      files: lines.slice(1).map((f) => f.trim().replace(/\\/g, "/")).filter(Boolean),
    });
  }
  return commits;
}

function readGitInfo(cwd, previousSha) {
  const commitSha = git(["rev-parse", "HEAD"], cwd);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const author = git(["log", "-1", "--format=%an", "HEAD"], cwd);

  // Range since the last recorded run; on the first run take the last 5 commits.
  let rangeArgs = ["-5"];
  if (previousSha) {
    try {
      git(["cat-file", "-e", `${previousSha}^{commit}`], cwd); // does it exist?
      rangeArgs = [`${previousSha}..HEAD`];
    } catch {
      console.warn(`[traceback] previous sha ${previousSha.slice(0, 7)} not in this repo — falling back to last 5 commits`);
    }
  }
  const output = git(["log", ...rangeArgs, "--name-only", "--pretty=format:--C--%H|%an|%s"], cwd);
  const commits = parseCommitBlocks(output);

  const changedFiles = [...new Set(commits.flatMap((c) => c.files))];
  return { commitSha, branch, author, commits, changedFiles, range: previousSha ? `${previousSha.slice(0, 7)}..HEAD` : "last 5 commits" };
}

module.exports = { readGitInfo };
