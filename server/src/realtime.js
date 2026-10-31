// Tiny in-process event bus: analysis/ingest modules publish "notices"
// (duplicate ingestion, rejected events) and the /stream route turns them
// into Server-Sent Event frames for connected dashboards. Keeps HTTP and
// SSE concerns decoupled without adding a dependency.

const { EventEmitter } = require("events");

const bus = new EventEmitter();

module.exports = bus;
