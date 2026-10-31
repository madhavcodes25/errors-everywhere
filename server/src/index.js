// Server entry point: connect to MongoDB, build the app, listen.
// Run with: npm start   (uses server/.env or environment variables)

const config = require("./config");
const { connectDatabase, safeUri } = require("./db");
const { buildApp } = require("./app");

async function main() {
  const { client, db, collections, memoryReplSet, isMemory } = await connectDatabase();
  const app = buildApp(collections, db);

  const server = app.listen(config.port, () => {
    console.log(`[server] Errors Everywhere API listening on http://localhost:${config.port}`);
    console.log(
      `[server] database: ${isMemory ? "in-memory replica set (dev only, wiped on restart)" : safeUri(config.mongoUri)}`
    );
  });

  // Graceful shutdown so tests and Ctrl+C never leave mongod hanging.
  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, shutting down...`);
    server.close();
    try {
      await client.close();
      if (memoryReplSet) await memoryReplSet.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
