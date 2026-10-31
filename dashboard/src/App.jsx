// Error Everywhere — app shell: sidebar (project, nav, connection), the
// three views, live SSE updates, toasts, and the welcome flow.

import { useEffect, useRef, useState } from "react";
import strings, { nav as navStrings, connection as connStrings } from "./copy/strings.js";
import { api } from "./api";
import { getDataSource, setDataSource, DEFAULT_PROJECT, TIMELINE_LIMIT } from "./config";
import { useRunStream, useApi } from "./hooks";
import { Timeline, VerdictHero } from "./components/Timeline";
import { RunDetailPage } from "./pages/RunDetail.jsx";
import { RejectedPage } from "./pages/Rejected";

const PROJECTS_KEY = "error-everywhere.projects";
const WELCOME_KEY = "error-everywhere.welcomeDone";

function loadProjects() {
  try {
    const list = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
    return list.includes(DEFAULT_PROJECT) ? list : [DEFAULT_PROJECT, ...list];
  } catch {
    return [DEFAULT_PROJECT];
  }
}

export default function App() {
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT);
  const [knownProjects, setKnownProjects] = useState(loadProjects);
  const [runs, setRuns] = useState(null);
  const [runsError, setRunsError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [view, setView] = useState("timeline"); // timeline | rejected
  const [rejectedVersion, setRejectedVersion] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [welcomeDone, setWelcomeDone] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) === "true";
    } catch {
      return true;
    }
  });
  const [sampleActive, setSampleActive] = useState(getDataSource() === "mock");
  const [theme, setTheme] = useState(() => localStorage.getItem("error-everywhere.theme") || "dark");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const lastSseAtRef = useRef(0);
  const runsRef = useRef([]);
  runsRef.current = runs || [];
  const searchRef = useRef(null);
  const projectInputRef = useRef(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("error-everywhere.theme", theme);
    } catch {
      /* fine */
    }
  }, [theme]);

  // "/" focuses search — unless the user is typing somewhere else.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
        e.preventDefault();
        if (searchRef.current) searchRef.current.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load the run list for the selected project (and on retry/reconnect).
  useEffect(() => {
    let alive = true;
    setRuns(null);
    setRunsError(null);
    api.runs(projectId, TIMELINE_LIMIT)
      .then((list) => alive && setRuns(list))
      .catch((err) => alive && setRunsError(err));
    return () => {
      alive = false;
    };
  }, [projectId, loadAttempt]);

  function pushToast(text, status) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, text, status }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function handleNotice(notice) {
    if (notice.type === "duplicate") {
      pushToast(strings.timeline.duplicateToast, "errored");
    } else if (notice.type === "rejected") {
      pushToast(strings.timeline.rejectedToast(notice.reason), "failed");
      setRejectedVersion((v) => v + 1);
    }
  }

  const streamState = useRunStream(
    (liveRun) => {
      if (liveRun.projectId !== projectId) return;
      lastSseAtRef.current = Date.now();
      const isNew = !runsRef.current.some((r) => r._id === liveRun._id);
      setRuns((prev) =>
        [liveRun, ...(prev || [])]
          .filter((run, i, all) => all.findIndex((r) => r._id === run._id) === i)
          .slice(0, TIMELINE_LIMIT)
      );
      if (isNew) {
        pushToast(strings.timeline.newRunToast(liveRun.status, String(liveRun.commitSha).slice(0, 7)), liveRun.status);
      }
    },
    handleNotice
  );

  // Reconnect: refresh the list so stale rows are replaced.
  useEffect(() => {
    if (streamState === "open") setLoadAttempt((a) => a + 1);
  }, [streamState]);

  function selectProject(id) {
    const trimmed = (id || "").trim();
    if (!trimmed) return;
    setProjectId(trimmed);
    setSelectedRunId(null);
    setView("timeline");
    setKnownProjects((prev) => {
      const next = prev.includes(trimmed) ? prev : [trimmed, ...prev];
      try {
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
      } catch {
        /* fine */
      }
      return next;
    });
  }

  // The chevron button opens the native list (never a second arrow).
  function openProjectPicker() {
    try {
      projectInputRef.current.showPicker();
    } catch {
      projectInputRef.current.focus(); // showPicker unsupported — focus instead
    }
  }

  function selectRun(runId) {
    setSelectedRunId(runId);
    setView("timeline");
    window.scrollTo(0, 0);
  }

  function loadSampleData() {
    setDataSource("mock");
    setSampleActive(true);
    setLoadAttempt((a) => a + 1);
  }

  function skipWelcome() {
    setWelcomeDone(true);
    try {
      localStorage.setItem(WELCOME_KEY, "true");
    } catch {
      /* fine */
    }
  }

  const selectedRun = (runs || []).find((r) => r._id === selectedRunId) || null;
  const latestRun = (runs || [])[0] || null;

  // The release verdict for the LATEST run — the big word at the top.
  const releaseQuery = useApi(
    () => (latestRun ? api.releaseCheck(projectId, latestRun._id) : Promise.resolve(null)),
    [projectId, latestRun && latestRun._id, loadAttempt]
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div>
          <div className="logo">{strings.app.name}</div>
          <div className="logo-tag">{strings.app.tagline}</div>
        </div>

        <div>
          <div className="side-label">{navStrings.project}</div>
          <div className="select-wrap">
            <input
              ref={projectInputRef}
              className="side-input select-input"
              list="known-projects"
              value={projectId}
              onChange={(e) => selectProject(e.target.value)}
              aria-label={navStrings.project}
            />
            <button
              type="button"
              className="select-chevron"
              aria-label="Choose project"
              onClick={openProjectPicker}
            />
          </div>
          <datalist id="known-projects">
            {knownProjects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>

        <nav className="side-nav" aria-label="Main">
          <button
            className={`side-link ${view === "timeline" && !selectedRunId ? "active" : ""}`}
            onClick={() => {
              setView("timeline");
              setSelectedRunId(null);
            }}
          >
            {navStrings.timeline}
          </button>
          <button
            className={`side-link ${view === "rejected" ? "active" : ""}`}
            onClick={() => {
              setView("rejected");
              setSelectedRunId(null);
            }}
          >
            {navStrings.rejected}
          </button>
        </nav>

        <div className="side-footer">
          <span className={`conn conn-${streamState}`}>
            <span className="conn-dot" aria-hidden="true" />
            {streamState === "open" ? connStrings.live : streamState === "closed" ? connStrings.lost : connStrings.connecting}
          </span>
          <button className="link-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? navStrings.themeLight : navStrings.themeDark}
          </button>
        </div>
      </aside>

      <main className="main">
        {streamState === "closed" && (
          <div className="banner" role="alert" data-testid="error-banner">
            {connStrings.lost}
          </div>
        )}

        {view === "rejected" ? (
          <div>
            <h1 className="display display-section">{strings.rejectedPage.title}</h1>
            <RejectedPage refreshKey={rejectedVersion} />
          </div>
        ) : selectedRun ? (
          <RunDetailPage
            projectId={projectId}
            run={selectedRun}
            onOpenRun={selectRun}
            onBack={() => setSelectedRunId(null)}
          />
        ) : (
          <>
            {runs && runs.length > 0 && (
              <VerdictHero
                release={releaseQuery.data}
                latestRun={latestRun}
                loading={releaseQuery.loading}
                error={releaseQuery.error}
                onRetry={releaseQuery.retry}
                onOpenRun={selectRun}
              />
            )}
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "8px 0 4px", flexWrap: "wrap" }}>
              <h1 className="display display-section" style={{ margin: 0 }}>
                {strings.timeline.title}
              </h1>
              <input
                ref={searchRef}
                className="side-input"
                style={{ maxWidth: 280, marginLeft: "auto" }}
                placeholder={strings.timeline.search}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label={strings.timeline.search}
              />
            </div>
            <Timeline
              runs={runs || []}
              loading={runs === null && !runsError}
              error={runsError}
              onRetry={() => setLoadAttempt((a) => a + 1)}
              onSelectRun={selectRun}
              selectedRunId={selectedRunId}
              filter={filter}
              welcome={!welcomeDone && runs !== null && runs.length === 0 && !runsError}
              onWelcomeSkip={skipWelcome}
              onSampleData={loadSampleData}
              sampleActive={sampleActive}
            />
          </>
        )}
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.status}`} data-testid="toast">
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}
