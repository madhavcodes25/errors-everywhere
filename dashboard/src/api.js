// The single data door. Every screen asks this client for data; the client
// decides whether to talk to the real API or to hand back mock data
// (see src/config — one switch, plus "Load sample data" in the welcome).

import { API_BASE, getDataSource } from "./config/index.js";
import * as mock from "./mock/data.js";

async function request(path, options) {
  let res;
  try {
    res = await fetch(API_BASE + path, options);
  } catch {
    throw new Error("We can't reach the server. It may be stopped — start it and try again.");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    throw new Error((body && body.error) || `The server answered with ${res.status}.`);
  }
  return body;
}

function mockDelay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), 200));
}

export const api = {
  runs(projectId, limit = 50) {
    if (getDataSource() === "mock") return mockDelay(mock.mockRuns.filter((r) => r.projectId === projectId));
    return request(`/projects/${encodeURIComponent(projectId)}/runs?limit=${limit}`).then((b) => b.runs);
  },

  diagnosis(runId) {
    if (getDataSource() === "mock") return mockDelay(mock.mockDiagnosis);
    return request(`/runs/${encodeURIComponent(runId)}/diagnosis`);
  },

  culprits(runId) {
    if (getDataSource() === "mock") return mockDelay(mock.mockCulprits);
    return request(`/runs/${encodeURIComponent(runId)}/culprits`);
  },

  changes(runId) {
    if (getDataSource() === "mock") return mockDelay(mock.mockChanges);
    return request(`/runs/${encodeURIComponent(runId)}/changes`);
  },

  releaseCheck(projectId, runId) {
    if (getDataSource() === "mock") return mockDelay(mock.mockRelease(projectId, runId));
    return request(
      `/projects/${encodeURIComponent(projectId)}/release-check${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`
    );
  },

  rejectedEvents(limit = 20) {
    if (getDataSource() === "mock") return mockDelay(mock.mockRejected);
    return request(`/rejected-events?limit=${limit}`);
  },

  summary(runId) {
    if (getDataSource() === "mock") {
      return mockDelay({
        runId,
        summary: {
          text:
            "Run run_9f3c2e1a0112 failed because \"payment charges card\" stopped passing after the last commit. " +
            "That commit is the most likely culprit with 74% confidence: high. " +
            "Next: compare src/payment.js with the last good run and revert the fee change.",
          source: "template",
        },
      });
    }
    return request(`/runs/${encodeURIComponent(runId)}/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then((body) => body.summary);
  },

  health() {
    return request("/health");
  },
};
