// ONE config file. API base URL, default project, and the single switch
// between the mock data (src/mock/data.js) and the real API.

export const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");
export const DEFAULT_PROJECT = import.meta.env.VITE_PROJECT_ID || "shop-api";
export const TIMELINE_LIMIT = 50;

// One switch for the data source. "real" talks to API_BASE; "mock" reads
// src/mock/data.js. "Load sample data" in the welcome steps flips this at
// runtime (stored in localStorage).
const SOURCE_KEY = "error-everywhere.dataSource";
const DEFAULT_SOURCE = import.meta.env.VITE_USE_MOCK === "true" ? "mock" : "real";

export function getDataSource() {
  try {
    return localStorage.getItem(SOURCE_KEY) || DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
}

export function setDataSource(source) {
  try {
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    /* private browsing — the switch just won't persist */
  }
}

// Feature flag for the optional AI summary.
export const FEATURES = { plainEnglishSummary: true };
