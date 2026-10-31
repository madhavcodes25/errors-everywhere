// The Express app with every route from the API contract.
// Built as a factory (buildApp(collections)) so tests can run it against
// their own database without touching the real one.

const express = require("express");
const { ingestEvent } = require("./ingest");
const { diagnoseRun } = require("./analysis/diagnose");
const { buildChanges } = require("./analysis/changes");
const { rankCulprits } = require("./analysis/culprits");
const { buildReleaseCheck } = require("./analysis/releaseCheck");
const { generateSummary } = require("./analysis/summarize");
const { setupStreamRoute } = require("./routes/stream");
const { redactDeep } = require("./lib/redact");

// Wrap async handlers so a rejected promise reaches the error middleware
// instead of hanging the request (Express 4 does not await them for us).
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function buildApp(collections, db) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Tiny request logger — enough for a hackathon, no dependency needed.
  app.use((req, res, next) => {
    if (req.path === "/stream") return next(); // SSE stays quiet, it never ends
    const started = Date.now();
    res.on("finish", () => {
      console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`);
    });
    next();
  });

  // The dashboard runs on another port in development — allow it.
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Rejected events (Part 8): what the server refused and why. Raw bodies
  // are RE-REDACTED on the way out — a rejected body was stored exactly as
  // received and may contain secrets a buggy client sent by mistake.
  // (Registered AFTER the CORS middleware so dashboards can actually read it.)
  app.get("/rejected-events", asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const docs = await collections.rejected.find({}).sort({ receivedAt: -1 }).limit(limit).toArray();
    const events = docs.map((d) => ({
      receivedAt: d.receivedAt,
      reason: d.reason,
      rawBody: redactDeep(d.rawBody).value,
    }));
    res.json({ count: events.length, events });
  }));

  // ---- API contract routes ---------------------------------------------

  // Liveness + database ping for the dashboard and CI.
  app.get("/health", asyncHandler(async (req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ status: "ok", database: "ok", uptimeSeconds: Math.round(process.uptime()) });
    } catch (err) {
      console.error("[api] health check: database unreachable:", err.message);
      res.status(503).json({ status: "degraded", database: "unreachable" });
    }
  }));

  // Ingest an event. Sending the same event twice is NOT an error (idempotent).
  app.post("/events", asyncHandler(async (req, res) => {
    const result = await ingestEvent(collections, req.body);
    res.status(result.code).json(result.body);
  }));

  // Run history for a project. Full run documents (including tests) so the
  // dashboard can show details without extra endpoints.
  app.get("/projects/:id/runs", asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const filter = { projectId: req.params.id };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.branch) filter.branch = String(req.query.branch);
    const runs = await collections.runs.find(filter).sort({ startedAt: -1 }).limit(limit).toArray();
    res.json({ projectId: req.params.id, count: runs.length, runs });
  }));

  // 1) Why did it fail?
  app.get("/runs/:id/diagnosis", asyncHandler(async (req, res) => {
    const result = await diagnoseRun(collections, req.params.id);
    res.status(result.code).json(result.body);
  }));

  // 2) What changed since it last worked? (?against=<runId>, default = last good)
  app.get("/runs/:id/changes", asyncHandler(async (req, res) => {
    const against = req.query.against ? String(req.query.against) : null;
    const result = await buildChanges(collections, req.params.id, against);
    res.status(result.code).json(result.body);
  }));

  // 3) Which commit most likely broke it?
  app.get("/runs/:id/culprits", asyncHandler(async (req, res) => {
    const result = await rankCulprits(collections, req.params.id);
    res.status(result.code).json(result.body);
  }));

  // 4) Is it safe to release today? (?runId=<runId>, default = latest)
  app.get("/projects/:id/release-check", asyncHandler(async (req, res) => {
    const runId = req.query.runId ? String(req.query.runId) : null;
    const result = await buildReleaseCheck(collections, req.params.id, runId);
    res.status(result.code).json(result.body);
  }));

  // Optional summary (rephrases the structured evidence, stores evidenceHash).
  app.post("/runs/:id/summary", asyncHandler(async (req, res) => {
    const force = Boolean(req.body && req.body.force);
    const result = await generateSummary(collections, req.params.id, { force });
    res.status(result.code).json(result.body);
  }));

  // GET /stream — registered BEFORE the catch-all below (it needs the raw
  // response object for Server-Sent Events).
  setupStreamRoute(app, collections);

  // ---- fallthrough + error handling: always JSON, never a crash ----------

  app.use((req, res) => {
    res.status(404).json({ error: `no route: ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && (err.type === "entity.parse.failed" || err.status === 400)) {
      console.warn("[api] rejected malformed JSON body:", err.message);
      return res.status(400).json({ error: `invalid JSON body: ${err.message}` });
    }
    // Body larger than the 1mb limit: reject cleanly, never crash.
    if (err && (err.type === "entity.too.large" || err.status === 413)) {
      console.warn("[api] rejected oversized body:", err.message);
      return res.status(413).json({ error: "request body too large (limit 1mb)" });
    }
    console.error("[api] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

module.exports = { buildApp };
