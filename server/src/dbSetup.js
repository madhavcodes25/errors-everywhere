// Schema validation ($jsonSchema) + indexes.
//
// `setupDatabase(db)` is IDEMPOTENT — safe to run on every server boot and
// as often as you like via `npm run db:setup`:
//   - collections are created with their validator (or the validator is
//     updated in place via collMod when the collection already exists)
//   - createIndex is a no-op when the index already exists
//
// Validation is a SECOND safety net behind the manual checks in ingest.js:
// even a buggy writer cannot store an event/run that breaks the contract.

const EVENT_VALIDATOR = {
  $jsonSchema: {
    title: "event (raw audit trail)",
    bsonType: "object",
    required: ["eventId", "projectId", "type", "timestamp"],
    properties: {
      eventId: { bsonType: "string", minLength: 1 },
      projectId: { bsonType: "string", minLength: 1 },
      type: { enum: ["run.completed", "deploy.completed"] },
      timestamp: { bsonType: "date" },
      receivedAt: { bsonType: "date" },
      // payload stays free-form: CI-specific data must not be constrained here.
      payload: { bsonType: "object" },
    },
  },
};

const RUN_VALIDATOR = {
  $jsonSchema: {
    title: "run (normalized, analysis reads this)",
    bsonType: "object",
    required: ["_id", "projectId", "commitSha", "startedAt", "status", "tests"],
    properties: {
      _id: { bsonType: "string" }, // "run_" + first 12 chars of eventId
      projectId: { bsonType: "string" },
      commitSha: { bsonType: "string" },
      startedAt: { bsonType: "date" },
      status: { enum: ["passed", "failed", "errored"] },
      tests: { bsonType: "array" }, // may be empty (errored runs)
    },
    // everything else (branch, author, commits, dependencies, ...) stays flexible
  },
};

const COLLECTIONS = ["events", "runs", "projects", "rejected_events"];

// Each index carries a `why` naming the question it speeds up.
const INDEXES = [
  {
    collection: "events",
    index: { eventId: 1 },
    options: { unique: true },
    why: "POST /events idempotency: the same eventId can never be stored twice",
  },
  {
    collection: "events",
    index: { projectId: 1, receivedAt: -1 },
    why: "audit trail: newest raw events for a project",
  },
  {
    collection: "runs",
    index: { projectId: 1, startedAt: -1 },
    why: "latest runs for a project (GET /projects/:id/runs, release check default)",
  },
  {
    collection: "runs",
    index: { projectId: 1, status: 1, startedAt: -1 },
    why: "filtered run lists, e.g. ?status=failed — 'what is broken right now?'",
  },
  {
    collection: "runs",
    index: { projectId: 1, "tests.name": 1 },
    why: "which runs exercised a given test? (flaky-test history)",
  },
  {
    collection: "runs",
    index: { projectId: 1, changedFiles: 1 },
    why: "which runs touched this file? (culprit / changes correlation)",
  },
  {
    collection: "runs",
    index: { projectId: 1, "tests.error.signature": 1 },
    why: "have we seen this failure signature before? (diagnosis recurring rule)",
  },
  {
    collection: "runs",
    index: { projectId: 1, branch: 1, startedAt: -1 },
    why: "analysis history: earlier runs on the same branch (baselines)",
  },
  {
    collection: "rejected_events",
    index: { receivedAt: -1 },
    why: "debugging: newest rejected payloads first",
  },
];

// Create a collection (with optional validator) or update its validator in place.
async function ensureCollection(db, name, validator) {
  try {
    const options = validator ? { validator } : undefined;
    await db.createCollection(name, options);
  } catch (err) {
    if (err.codeName !== "NamespaceExists") throw err;
    if (validator) {
      await db.command({ collMod: name, validator });
    }
  }
}

async function setupDatabase(db) {
  await ensureCollection(db, "events", EVENT_VALIDATOR);
  await ensureCollection(db, "runs", RUN_VALIDATOR);
  await ensureCollection(db, "projects"); // flexible: { _id, name, requiredEnvKeys }
  await ensureCollection(db, "rejected_events");

  for (const { collection, index, options = {} } of INDEXES) {
    await db.collection(collection).createIndex(index, options);
  }
}

module.exports = { setupDatabase, INDEXES, COLLECTIONS, EVENT_VALIDATOR, RUN_VALIDATOR };
