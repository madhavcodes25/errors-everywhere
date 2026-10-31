// Reset the sample project to the healthy state:
//   - git reset --hard healthy (drops demo scenario commits)
//   - rewrite the gitignored .env with the canonical demo values
// Safe to run any time, as often as needed.

const { resetSampleProject, git } = require("./lib");

resetSampleProject();
console.log(`[reset] sample-project restored to the healthy state (${git(["rev-parse", "--short", "HEAD"])})`);
console.log("[reset] .env rewritten with the canonical demo values.");
