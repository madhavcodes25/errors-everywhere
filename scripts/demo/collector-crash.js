// npm run demo:collector-crash — breaks Jest on purpose so the COLLECTOR
// cannot produce results. The collector still sends a status "errored" run
// (never fail silently); it shows up grey in the timeline with the
// collectorError message on the run page. jest.config.js is restored
// afterwards — via git, which also heals any previously poisoned copy.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { SAMPLE, runCollector, step } = require("./lib");

const configPath = path.join(SAMPLE, "jest.config.js");

// git knows the committed content — more robust than a manual backup (a
// backup taken from an already-corrupted file would keep it corrupted).
function restoreConfig() {
  const res = spawnSync("git", ["-C", SAMPLE, "checkout", "--", "jest.config.js"], {
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`git checkout failed: ${res.stderr}`);
  if (!fs.readFileSync(configPath, "utf8").includes("module.exports")) {
    throw new Error("jest.config.js still looks broken after the restore");
  }
  console.log("[demo] jest.config.js restored and verified.");
}

let errored = false;
try {
  step("Breaking jest.config.js so Jest cannot even start...");
  fs.writeFileSync(configPath, "this is ((( not valid javascript");

  step("Running the collector — it must report an ERRORED run, not crash...");
  const result = runCollector();
  console.log(result.output);
  errored = /Run sent: ERRORED/.test(result.output);
  console.log(
    errored
      ? "\n[demo] ERRORED run recorded — grey dot in the timeline, collectorError shown on the run page."
      : "\n[demo] expected an ERRORED run — something went wrong."
  );
} finally {
  // The restore happens HERE, before any exit — never leave the sample
  // project broken (a process.exit inside the try would skip it!).
  try {
    restoreConfig();
  } catch (err) {
    console.error(`[demo] RESTORE FAILED: ${err.message} — run scripts/scenarios/reset.js`);
  }
}
process.exitCode = errored ? 0 : 1; // exitCode (not exit): lets stdout flush before the process ends
