// GET /stream — Server-Sent Events feed of live runs.
//
// Primary path: ONE shared MongoDB change stream on the `runs` collection
// broadcasts to every connected client (change streams need a replica set —
// Atlas free tier always is one).
//   - inserts and replaces always broadcast (a new run)
//   - updates broadcast ONLY when the run's status changed
//   - the change stream RESTARTS with backoff when it errors; if the server
//     is not a replica set we log clearly and fall back to 3s polling
//     instead of crashing.
// Disconnects are removed from the client set; a heartbeat comment goes to
// every client every 25 seconds so proxies keep the connection open.

function setupStreamRoute(app, collections) {
  const bus = require("../realtime");
  const clients = new Set(); // open SSE responses
  let changeStream = null;
  let changeStreamStarting = false;
  let pollTimer = null;
  let heartbeatTimer = null;
  const lastStatuses = new Map(); // runId -> last broadcast status

  // Broadcast a compact run summary (id, status, commit, time, short info).
  function broadcast(run) {
    if (!run || clients.size === 0) return;
    const payload = JSON.stringify({
      runId: run._id,
      projectId: run.projectId,
      status: run.status,
      commitSha: run.commitSha,
      branch: run.branch,
      author: run.author,
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      failedTests: (run.tests || []).filter((t) => t.status === "failed").length,
    });
    for (const res of clients) {
      try {
        res.write(`event: run\ndata: ${payload}\n\n`);
      } catch {
        clients.delete(res); // dead socket — drop it
      }
    }
  }

  // Only broadcast runs whose status CHANGED (inserts always count as new).
  function shouldBroadcast(run) {
    if (!run) return false;
    const previous = lastStatuses.get(run._id);
    lastStatuses.set(run._id, run.status);
    if (lastStatuses.size > 500) lastStatuses.clear(); // keep the map tiny
    return previous !== run.status;
  }

  function handleRunEvent(change) {
    const run = change.fullDocument;
    if (run && shouldBroadcast(run)) broadcast(run);
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      for (const res of clients) {
        try {
          res.write(": heartbeat\n\n"); // comment frame — keeps proxies alive
        } catch {
          clients.delete(res);
        }
      }
    }, 25 * 1000);
  }

  function stopAll() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pollTimer) clearInterval(pollTimer);
    heartbeatTimer = null;
    pollTimer = null;
    if (changeStream) {
      changeStream.close().catch(() => {});
      changeStream = null;
    }
    changeStreamStarting = false;
  }

  // 3s polling fallback (standalone mongod without a replica set).
  function startPolling() {
    if (pollTimer || clients.size === 0) return;
    let watermark = new Date();
    pollTimer = setInterval(async () => {
      try {
        const fresh = await collections.runs
          .find({ startedAt: { $gt: watermark } })
          .sort({ startedAt: 1 })
          .limit(20)
          .toArray();
        for (const run of fresh) {
          if (run.startedAt > watermark) watermark = run.startedAt;
          if (shouldBroadcast(run)) broadcast(run);
        }
      } catch (err) {
        console.error("[stream] polling failed:", err.message);
      }
    }, 3000);
  }

  // Analysis/ingest notices (duplicates, rejections) become SSE frames so
  // dashboards can toast them live even though MongoDB itself saw no change.
  bus.on("notice", (notice) => {
    if (clients.size === 0) return;
    const payload = JSON.stringify(notice);
    for (const res of clients) {
      try {
        res.write(`event: notice\ndata: ${payload}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  });

  // Change stream with restart-on-error (5 attempts, growing delay).
  // watch() returns a ChangeStream EventEmitter SYNCHRONOUSLY in driver v6 —
  // errors arrive on the "error" event, not as a rejected promise.
  function startChangeStream(attempt = 1) {
    if (changeStream || changeStreamStarting || clients.size === 0) return;
    changeStreamStarting = true;
    try {
      const stream = collections.runs.watch([], { fullDocument: "updateLookup" });
      changeStreamStarting = false;
      changeStream = stream;
      console.log("[stream] watching the runs collection via change stream");
      stream.on("change", handleRunEvent);
      stream.on("error", (err) => {
        console.warn("[stream] change stream error:", err.message);
        changeStream = null;
        try {
          stream.close();
        } catch {
          /* already closed */
        }
        classifyAndRecover(err, attempt);
      });
    } catch (err) {
      changeStreamStarting = false;
      classifyAndRecover(err, attempt);
    }
  }

  // Restart on transient errors; fall back to polling when the deployment
  // simply cannot do change streams (not a replica set) — never crash.
  function classifyAndRecover(err, attempt) {
    const message = err && (err.message || String(err));
    const notReplicaSet =
      (err && (err.code === 40573 || err.codeName === "NoReplicationEnabled")) ||
      /replica set/i.test(message || "");
    if (notReplicaSet) {
      console.warn(
        "[stream] change streams require a REPLICA SET, but this MongoDB is not one.\n" +
          "         Falling back to 3s polling (works, just not instant).\n" +
          "         For instant live updates use MongoDB Atlas — even the free tier is a replica set."
      );
      startPolling();
      return;
    }
    if (attempt < 5) {
      const delayMs = 1000 * attempt;
      console.warn(`[stream] restarting change stream in ${delayMs}ms (attempt ${attempt + 1}/5)`);
      setTimeout(() => startChangeStream(attempt + 1), delayMs);
    } else {
      console.warn("[stream] change stream kept failing after 5 attempts — falling back to 3s polling.");
      startPolling();
    }
  }

  app.get("/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("retry: 3000\n\n"); // client reconnect hint (ms)
    clients.add(res);
    startHeartbeat();
    if (clients.size === 1) startChangeStream();

    req.on("close", () => {
      clients.delete(res);
      if (clients.size === 0) stopAll(); // nobody listening — free the resources
    });
  });
}

module.exports = { setupStreamRoute };
