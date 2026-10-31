#!/usr/bin/env node
// Errors Everywhere collector CLI (zero dependencies, Node 20+).
//
//   errors-everywhere run    --project shop-api [--server http://localhost:4000] [--cwd <dir>]
//   errors-everywhere resend [--server http://localhost:4000] [--cwd <dir>]
//
// Run it from inside the project it should record (or pass --cwd).
// With `npm link` inside collector/ the `errors-everywhere` command is global;
// otherwise: node collector/bin/errors-everywhere.js run ...

const { runCollector, resendLastEvent } = require("../src/collector");

const HELP = `
Errors Everywhere collector — records a test run for the Errors Everywhere flight recorder.

Commands:
  run     Run jest, read git/env/deps, send a run.completed event
  resend  Re-send the exact last event (.errors-everywhere/last-event.json) —
          demonstrates duplicate protection

Options:
  --project <id>   Project identifier (required for "run")
  --server <url>   Errors Everywhere server base URL (default: http://localhost:4000)
  --cwd <dir>      Target project directory (default: current directory)
  --help           Show this help
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = value;
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";

  if (command === "help" || args.help) {
    console.log(HELP);
    process.exit(0);
  }

  const serverUrl = String(args.server || "http://localhost:4000");
  const cwd = String(args.cwd || process.cwd());

  if (command === "run") {
    if (!args.project || typeof args.project !== "string") {
      console.error('[errors-everywhere] missing --project (e.g. errors-everywhere run --project shop-api)');
      process.exit(1);
    }
    const code = await runCollector({ projectId: args.project, serverUrl, cwd });
    process.exit(code);
  }

  if (command === "resend") {
    const code = await resendLastEvent({ serverUrl, cwd });
    process.exit(code);
  }

  console.error(`[errors-everywhere] unknown command: ${command}\n${HELP}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[errors-everywhere] unexpected collector crash:", err);
  process.exit(1);
});
