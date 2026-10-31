// npm run demo:bad-event — sends an event WITHOUT projectId. The server
// answers 400 with a clear reason and stores it in rejected_events; the
// dashboard's "Rejected events" page lists it.

const { post, step } = require("./lib");

async function main() {
  step("Sending an event with NO projectId (incomplete input)...");
  const res = await post("/events", {
    type: "run.completed",
    payload: {
      commitSha: "bad0000000000000000000000000000000000001",
      branch: "main",
      author: "Demo Script",
      ciRunId: "demo-bad-event-" + Date.now(),
      attempt: 1,
      startedAt: new Date().toISOString(),
      finishedAt: new Date(Date.now() + 1000).toISOString(),
      status: "passed",
      tests: [],
    },
  });

  if (res.status === 400 && res.body.error) {
    console.log(`Server answered 400 with a clear reason: "${res.body.error}"`);
    console.log("The body was stored in rejected_events — see the dashboard's 'Rejected events' page.");
    process.exitCode = 0; // exitCode (not exit): lets stdout flush before the process ends
  }
  console.log(`Unexpected response: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  process.exitCode = 1; // exitCode (not exit): lets stdout flush before the process ends
}

main().catch((err) => {
  console.error("demo:bad-event failed:", err.message);
  process.exitCode = 1; // exitCode (not exit): lets stdout flush before the process ends
});
