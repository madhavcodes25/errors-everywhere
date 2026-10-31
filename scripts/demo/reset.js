// npm run demo:reset — restore a clean, seeded demo state in under a minute.
//
//   1. sample project -> healthy state (git reset --hard healthy + .env)
//   2. database:
//      - MONGODB_URI set  -> wipes the four collections directly and reseeds
//        through the API, fully automatic.
//      - no MONGODB_URI   -> the running server owns an in-memory database
//        that another process CANNOT wipe. Restart the server, then run
//        `npm run demo:seed` (the two steps are printed below).

const { spawnSync } = require("child_process");
const path = require("path");
const { resetSampleProject } = require("../scenarios/lib");

const ROOT = path.join(__dirname, "..", "..");
module.paths.push(path.join(ROOT, "server", "node_modules")); // reuse server deps

const config = require(path.join(ROOT, "server", "src", "config"));
const resettable = Boolean(config.mongoUri);

console.log("[demo:reset] 1/2 restoring the sample project...");
resetSampleProject();
console.log("[demo:reset] sample project is healthy again.");

if (resettable) {
  (async () => {
    console.log("[demo:reset] 2/2 wiping the database and reseeding...");
    const { MongoClient } = require("mongodb");
    const { setupDatabase } = require(path.join(ROOT, "server", "src", "dbSetup"));
    const client = new MongoClient(config.mongoUri);
    await client.connect();
    const db = client.db(config.dbName);
    for (const name of ["events", "runs", "projects", "rejected_events"]) {
      const res = await db.collection(name).deleteMany({});
      console.log(`  - ${name}: removed ${res.deletedCount} documents`);
    }
    await setupDatabase(db);
    await client.close();

    const seed = spawnSync(process.execPath, [path.join(__dirname, "..", "seed-via-api.js")], {
      encoding: "utf8",
    });
    console.log((seed.stdout || "") + (seed.stderr || ""));
    console.log("[demo:reset] clean, seeded state restored — rehearse away.");
    process.exit(0);
  })();
} else {
  console.log(
    "[demo:reset] 2/2 the running server uses a TEMPORARY in-memory database, which\n" +
      "             this script cannot wipe from outside. Two quick steps instead:\n" +
      "               1. restart the server   (Ctrl+C, then: cd server && npm start)\n" +
      "               2. reseed it            (npm run demo:seed)\n" +
      "             Tip: set MONGODB_URI (Atlas free tier) and this becomes fully automatic."
  );
}
