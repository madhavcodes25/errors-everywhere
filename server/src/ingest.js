// POST /events pipeline: validate -> idempotent insert -> normalize -> run upsert.
//
// Every failure mode produces a CLEAR error message, is logged, and the raw
// body lands in rejected_events — bad input is never silently dropped.
// The runs upsert runs EVEN FOR duplicate events, so a retry after a crash
// between the two stores repairs the missing run instead of skipping it.

const crypto = require("crypto");
const { redactDeep } = require("./lib/redact");
const { toRunDocument, runIdFromEventId } = require("./normalize");
const bus = require("./realtime");

const EVENT_TYPES = ["run.completed", "deploy.completed"];
const RUN_STATUSES = ["passed", "failed", "errored"];

// The idempotency formula from the data contract:
// eventId = sha1(projectId + ":" + commitSha + ":" + ciRunId + ":" + attempt)
function computeEventId({ projectId, commitSha, ciRunId, attempt }) {
  const raw = `${projectId}:${commitSha}:${ciRunId}:${attempt}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

// Manual validation BEFORE touching the database.
// Returns a string describing the problem, or null when the body is valid.
function validateEventBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Invalid body: expected a JSON object";
  }
  if (typeof body.projectId !== "string" || !body.projectId.trim()) {
    return "Missing required field: projectId";
  }
  if (body.type === undefined) {
    return "Missing required field: type";
  }
  if (!EVENT_TYPES.includes(body.type)) {
    return `Invalid field type: must be one of ${EVENT_TYPES.map((t) => `"${t}"`).join(", ")} (got ${JSON.stringify(body.type)})`;
  }
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    return "Missing required field: payload";
  }
  if (body.timestamp !== undefined && Number.isNaN(new Date(body.timestamp).getTime())) {
    return "Invalid field timestamp: must be a valid date";
  }

  if (body.type === "run.completed") {
    const p = body.payload;
    for (const field of ["commitSha", "branch", "author", "ciRunId"]) {
      if (typeof p[field] !== "string" || !p[field].trim()) {
        return `Missing required field: payload.${field}`;
      }
    }
    if (p.attempt === undefined || !Number.isInteger(Number(p.attempt)) || Number(p.attempt) < 1) {
      return "Invalid field payload.attempt: must be an integer >= 1";
    }
    if (Number.isNaN(new Date(p.startedAt).getTime())) {
      return "Missing or invalid field: payload.startedAt";
    }
    if (Number.isNaN(new Date(p.finishedAt).getTime())) {
      return "Missing or invalid field: payload.finishedAt";
    }
    if (p.status !== undefined && !RUN_STATUSES.includes(p.status)) {
      return `Invalid field payload.status: must be one of ${RUN_STATUSES.join(", ")} when provided`;
    }
    if (p.tests !== undefined && !Array.isArray(p.tests)) {
      return "Invalid field payload.tests: must be an array when provided";
    }
  }
  return null;
}

// Store the rejected body for auditing, then tell the caller exactly why.
// A notice goes out on the realtime bus so open dashboards can react live.
async function rejectEvent(collections, rawBody, reason) {
  console.warn(`[events] rejected: ${reason}`);
  try {
    await collections.rejected.insertOne({ receivedAt: new Date(), reason, rawBody });
  } catch (err) {
    console.error("[events] could not store rejected event:", err.message);
  }
  bus.emit("notice", { type: "rejected", reason });
  return { code: 400, body: { error: reason } };
}

// Full ingest. Returns { code, body } for the HTTP layer.
async function ingestEvent(collections, rawBody) {
  // 1) Manual validation first — bad input never reaches the DB.
  const problem = validateEventBody(rawBody);
  if (problem) return rejectEvent(collections, rawBody, problem);

  const payload = rawBody.payload;
  const eventId = computeEventId({
    projectId: rawBody.projectId,
    commitSha: payload.commitSha,
    ciRunId: payload.ciRunId,
    attempt: payload.attempt,
  });
  const runId = runIdFromEventId(eventId);

  // If the client computed its own eventId it MUST match the formula —
  // otherwise the two implementations have drifted and we refuse loudly.
  if (rawBody.eventId !== undefined && rawBody.eventId !== eventId) {
    return rejectEvent(
      collections,
      rawBody,
      `eventId mismatch: body says ${rawBody.eventId}, server formula says ${eventId}`
    );
  }

  // Redact secrets BEFORE anything is stored anywhere.
  const { value: safePayload, changed } = redactDeep(payload);

  const eventDoc = {
    eventId,
    projectId: rawBody.projectId,
    type: rawBody.type,
    timestamp: rawBody.timestamp ? new Date(rawBody.timestamp) : new Date(),
    receivedAt: new Date(),
    payload: safePayload,
    ...(changed ? { redacted: true } : {}),
  };

  // 2) events collection: $setOnInsert + upsert makes re-sending the same
  //    event a no-op (the unique index backstops concurrent racing writers).
  let duplicate = false;
  try {
    const result = await collections.events.updateOne(
      { eventId },
      { $setOnInsert: eventDoc },
      { upsert: true }
    );
    duplicate = result.upsertedCount === 0;
    if (duplicate) {
      console.log(`[events] duplicate eventId ${eventId} — ignored (idempotent)`);
      // Nothing changed in MongoDB, so no change-stream event fires — send an
      // explicit notice so dashboards can show "Duplicate ignored".
      bus.emit("notice", { type: "duplicate", eventId, runId });
    }
  } catch (err) {
    if (err.code === 11000) {
      duplicate = true; // lost a race against a concurrent identical upsert
    } else {
      throw err;
    }
  }

  // 3) projects collection: create on first sight, keep requiredEnvKeys fresh.
  const projectUpdate = { $set: { name: payload.projectName || rawBody.projectId } };
  if (Array.isArray(payload.requiredEnvKeys)) {
    projectUpdate.$set.requiredEnvKeys = payload.requiredEnvKeys.map(String);
  }
  const projectDoc = await collections.projects.findOneAndUpdate(
    { _id: rawBody.projectId },
    projectUpdate,
    { upsert: true, returnDocument: "after" }
  );

  // 4) runs collection: normalized document the analysis engine reads.
  //    Always upserted — also on duplicate events — so a retry after a crash
  //    between steps 2 and 4 repairs the missing run. Upserting the same
  //    normalized document twice is harmless (deterministic content).
  if (rawBody.type === "run.completed") {
    const run = toRunDocument({ ...rawBody, eventId }, projectDoc);
    await collections.runs.replaceOne({ _id: run._id }, run, { upsert: true });
  }

  return duplicate
    ? { code: 200, body: { status: "duplicate_ignored", eventId, runId } }
    : { code: 201, body: { status: "stored", eventId, runId } };
}

module.exports = { ingestEvent, computeEventId, validateEventBody };
