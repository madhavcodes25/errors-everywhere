// npm run db:setup — create collections ($jsonSchema validators) + indexes.
// IDEMPOTENT: safe to run repeatedly; each run also proves it by running
// setupDatabase twice (connectDatabase already applied it once on connect).

const config = require("../src/config");
const { connectDatabase, safeUri } = require("../src/db");
const { setupDatabase, INDEXES, COLLECTIONS } = require("../src/dbSetup");

async function main() {
  const { client, db, memoryReplSet, isMemory } = await connectDatabase();
  console.log(
    `[db:setup] target: ${
      isMemory
        ? "in-memory replica set (MONGODB_URI not set — data is temporary, set Atlas URI for real storage)"
        : safeUri(config.mongoUri)
    } / db "${db.databaseName}"`
  );

  await setupDatabase(db); // second run in this process — no errors = idempotent
  console.log("[db:setup] collections ensured (with $jsonSchema validators where defined):");
  for (const name of COLLECTIONS) console.log(`  - ${name}`);

  console.log("[db:setup] indexes ensured:");
  for (const { collection, index, options = {}, why } of INDEXES) {
    console.log(`  - ${collection} ${JSON.stringify(index)}${options.unique ? "  (unique)" : ""}`);
    console.log(`      speeds up: ${why}`);
  }

  console.log("[db:setup] done (safe to run again).");
  await client.close();
  // Stop the temporary in-memory mongod (if we started one) so the process
  // can actually exit instead of lingering on the child process.
  if (memoryReplSet) await memoryReplSet.stop();
}

main().catch((err) => {
  console.error("[db:setup] failed:", err);
  process.exit(1);
});
