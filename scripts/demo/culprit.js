// npm run demo:culprit — scenario F: three commits land together (README,
// cart tweak, and the real culprit in payment.js), then ONE test run covers
// the whole bundle. Culprit Ranking should put the payment commit on top.
// Changes are KEPT so you can browse the dashboard; demo:reset cleans up.

const { runCollector, step } = require("./lib");
const fScenario = require("../scenarios/F_commit_bundle");

step("Applying scenario F (3 commits: README, cart tweak, payment culprit)...");
fScenario.apply();

step("Recording the run (one run covers the whole commit bundle)...");
const result = runCollector();
console.log(result.output);
console.log("\n[demo] Watch the dashboard: Culprit Ranking puts the payment.js commit on top.");
process.exitCode = result.code === 0 ? 0 : 1; // exitCode (not exit): lets stdout flush before the process ends
