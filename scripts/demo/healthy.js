// npm run demo:healthy — a green run on the healthy sample project.
// Watch it appear live (green dot) in the dashboard timeline.

const { runCollector, step } = require("./lib");

step("Recording a healthy run (the collector runs the tests and reports)...");
const result = runCollector();
console.log(result.output);
process.exitCode = result.code === 0 ? 0 : 1; // exitCode (not exit): lets stdout flush before the process ends
