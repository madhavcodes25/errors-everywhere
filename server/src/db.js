// Database connection + collections.
//
// If MONGODB_URI is set (e.g. MongoDB Atlas) we use it. If not, we start a
// local IN-MEMORY replica set so the whole app — including change streams,
// which need a replica set — runs with zero setup. In-memory data is lost on
// restart; it is for development and demos only.
//
// Collections, $jsonSchema validators and indexes are applied on EVERY
// connect via setupDatabase() (idempotent — see dbSetup.js). `npm run
// db:setup` runs the same routine against a database without the server.

const { MongoClient } = require("mongodb");
const config = require("./config");
const { setupDatabase } = require("./dbSetup");

// Start a single-node replica set in memory. Change streams work on it.
async function startMemoryDatabase() {
  const { MongoMemoryReplSet } = require("mongodb-memory-server");
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return { uri: replSet.getUri(config.dbName), replSet };
}

// Connect (or start the memory fallback) and return everything the app needs.
// forceMemory=true is used by tests so a stray MONGODB_URI can never point
// them at a real cluster.
async function connectDatabase({ forceMemory = false } = {}) {
  let uri = config.mongoUri;
  let memoryReplSet = null;

  if (forceMemory || !uri) {
    if (forceMemory) {
      console.log("[db] forcing in-memory database (test mode)");
    } else {
      console.warn(
        "[db] MONGODB_URI is not set — starting a LOCAL IN-MEMORY replica set. " +
          "Data will be lost when the server stops. Set MONGODB_URI (Atlas works great) for real storage."
      );
    }
    const memory = await startMemoryDatabase();
    uri = memory.uri;
    memoryReplSet = memory.replSet;
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(config.dbName);

  // Idempotent: collections + $jsonSchema validators + indexes.
  await setupDatabase(db);

  const collections = {
    events: db.collection("events"),
    runs: db.collection("runs"),
    projects: db.collection("projects"),
    rejected: db.collection("rejected_events"),
  };

  return { client, db, collections, memoryReplSet, isMemory: Boolean(memoryReplSet) };
}

// Hide credentials in connection strings before logging them.
function safeUri(uri) {
  return uri.replace(/\/\/[^@/]+@/, "//***:***@");
}

module.exports = { connectDatabase, safeUri };
