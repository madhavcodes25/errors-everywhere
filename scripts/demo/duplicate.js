// npm run demo:duplicate — re-sends the last collected event. Idempotency:
// the server stores it ONCE (same eventId), returns duplicate_ignored, and
// the dashboard toasts "Duplicate ignored" while the run count stays put.

const fs = require("fs");
const path = require("path");
const { SAMPLE, post, serverUrl, step } = require("./lib");

const lastEventPath = path.join(SAMPLE, ".errors-everywhere", "last-event.json");

async function main() {
  let event;
  if (fs.existsSync(lastEventPath)) {
    event = JSON.parse(fs.readFileSync(lastEventPath, "utf8"));
    step("Re-sending the exact last event from sample-project/.errors-everywhere/last-event.json...");
    const res = await post("/events", event);
    if (res.status === 200 && res.body.status === "duplicate_ignored") {
      console.log("Duplicate ignored — the run count did not change (idempotency works).");
      process.exitCode = 0; // exitCode (not exit): lets stdout flush before the process ends
      return;
    }
    console.log(`Unexpected response: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    process.exitCode = 1; // exitCode (not exit): lets stdout flush before the process ends
    return;
  }

  // No collector run yet: send one fresh event twice — the second is the dup.
  step("No last-event.json found — sending one fresh event, then the SAME event again...");
  const fresh = {
    projectId: "shop-api",
    type: "run.completed",
    payload: {
      projectName: "shop-api",
      requiredEnvKeys: ["DATABASE_URL", "STRIPE_KEY"],
      commitSha: "d1d11c1e0000000000000000000000000000001",
      branch: "main",
      author: "Demo Script",
      ciRunId: "demo-duplicate-" + Date.now(),
      attempt: 1,
      startedAt: new Date().toISOString(),
      finishedAt: new Date(Date.now() + 1000).toISOString(),
      status: "passed",
      commits: [{ sha: "d1d11c1e0000000000000000000000000000001", message: "demo: duplicate", author: "Demo Script", files: ["README.md"] }],
      changedFiles: ["README.md"],
      dependencies: [{ name: "express", version: "^4.21.2" }],
      envKeys: ["DATABASE_URL", "STRIPE_KEY"],
      missingEnvKeys: [],
      tests: [{ name: "adds a new item to the cart", file: "tests/cart.test.js", status: "passed", durationMs: 30 }],
    },
  };
  const first = await post("/events", fresh);
  const second = await post("/events", fresh);
  if (first.status === 201 && second.status === 200 && second.body.status === "duplicate_ignored") {
    console.log("First send stored, second send: Duplicate ignored — idempotency works.");
    process.exitCode = 0; // exitCode (not exit): lets stdout flush before the process ends
  } else {
    console.log(`Unexpected responses: ${first.status} ${JSON.stringify(first.body)} / ${second.status} ${JSON.stringify(second.body)}`);
    process.exitCode = 1; // exitCode (not exit): lets stdout flush before the process ends
  }
}

main().catch((err) => {
  console.error("demo:duplicate failed:", err.message);
  process.exitCode = 1; // exitCode (not exit): lets stdout flush before the process ends
});
