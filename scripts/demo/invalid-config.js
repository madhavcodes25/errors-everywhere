// npm run demo:invalid-config — scenario E: STRIPE_KEY removed from the
// environment. The config test fails, the collector reports the missing env
// var, Errors Everywhere diagnoses environment_problem and the release risk jumps.
// The sample project is reset afterwards — ALWAYS, before the process exits
// (a process.exit inside the try would skip it).

const { runCollector, step } = require("./lib");
const { resetSampleProject } = require("../scenarios/lib");
const eScenario = require("../scenarios/E_bad_config");

let ok = false;
try {
  step("Removing STRIPE_KEY from the environment (scenario E)...");
  eScenario.apply();

  step("Recording the run — the missing env var must show up...");
  const result = runCollector();
  console.log(result.output);
  ok = result.code === 0;
  console.log(
    "\n[demo] Watch the dashboard: diagnosis says environment_problem, " +
      "release-check adds +20 for the missing env var."
  );
} catch (err) {
  console.error(`[demo] failed: ${err.message}`);
} finally {
  resetSampleProject();
  console.log("[demo] sample project reset to the healthy state.");
}
process.exitCode = ok ? 0 : 1; // exitCode (not exit): lets stdout flush before the process ends
