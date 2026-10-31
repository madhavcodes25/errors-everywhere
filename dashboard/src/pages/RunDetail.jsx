// Run detail: "Why run X failed" (serif), diagnosis cards, the Culprit
// Ranking hero, the seen-before box, then What changed and Release check.

import { useState } from "react";
import strings, { runDetail } from "../copy/strings.js";
import { useApi } from "../hooks";
import { api } from "../api";
import { WhyFailed, CulpritRanking, SeenBeforeBox } from "../components/WhyFailed";
import { ChangesView } from "../components/ChangesView";
import { ReleaseCheck } from "../components/ReleaseCheck";
import { ErrorState, Skeleton, StatusWord } from "../components/primitives";

// "Explain in plain English" — POSTs the run to the summary endpoint and
// shows the text with a badge saying where it came from.
function SummaryButton({ runId }) {
  const [state, setState] = useState("idle"); // idle | loading | done | unavailable
  const [summary, setSummary] = useState(null);

  async function explain() {
    setState("loading");
    try {
      const body = await api.summary(runId);
      setSummary(body);
      setState("done");
    } catch {
      setState("unavailable"); // the button disables itself — no silent failure
    }
  }

  return (
    <div className="summary-block">
      <button className="btn" onClick={explain} disabled={state === "loading" || state === "unavailable"}>
        {state === "loading" ? runDetail.summaryLoading : runDetail.summaryButton}
      </button>
      {state === "unavailable" && <span className="muted" style={{ marginLeft: 8 }}>{runDetail.summaryUnavailable}</span>}
      {state === "done" && summary && (
        <div className="panel" style={{ textAlign: "left", marginTop: 10 }}>
          <span className={`badge ${summary.source === "llm" ? "badge-accent" : "badge-grey"}`}>
            {summary.source === "llm" ? runDetail.badgeLlm : runDetail.badgeTemplate}
          </span>
          <p className="prose" style={{ marginBottom: 0 }}>{summary.text}</p>
        </div>
      )}
    </div>
  );
}

export function RunDetailPage({ projectId, run, onOpenRun, onBack }) {
  const [tab, setTab] = useState("why");
  const diagnosis = useApi(() => api.diagnosis(run._id), [run._id]);
  const culprits = useApi(() => api.culprits(run._id), [run._id]);
  const changes = useApi(() => api.changes(run._id), [run._id, tab]);
  const release = useApi(() => api.releaseCheck(projectId, run._id), [projectId, run._id, tab]);

  const failed = (run.tests || []).filter((t) => t.status === "failed").length;
  const isErrored = run.status === "errored";

  return (
    <div>
      <button className="btn" style={{ marginBottom: 16 }} onClick={onBack}>
        {runDetail.back}
      </button>

      <header style={{ marginBottom: 8 }}>
        <div className="label">{isErrored ? strings.timeline.erroredLabel : runDetail.tabs.why}</div>
        <h1 className={`display display-page ${isErrored ? "muted" : ""}`}>
          {isErrored ? strings.runDetail.erroredNote : run.status === "passed" ? runDetail.passedTitle(String(run.commitSha).slice(0, 7)) : runDetail.whyTitle(String(run.commitSha).slice(0, 7))}
        </h1>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          <StatusWord status={run.status} /> · {run.branch} · {run.author} ·{" "}
          {(run.durationMs / 1000).toFixed(1)}s ·{" "}
          {failed > 0 ? strings.runDetail.testsOf(failed, (run.tests || []).length) : strings.runDetail.allPassed}
        </p>
      </header>

      {run.collectorError && (
        <div className="banner" role="alert">
          <strong>{runDetail.collectorErrorLabel}</strong>
          <div className="mono" style={{ fontSize: "var(--fs-13)", marginTop: 6 }}>{run.collectorError}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "18px 0 4px", flexWrap: "wrap" }}>
        {[
          ["why", runDetail.tabs.why],
          ["changes", runDetail.tabs.changes],
          ["release", runDetail.tabs.release],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`btn ${tab === key ? "btn-primary" : ""}`}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <SummaryButton runId={run._id} />
        </div>
      </div>

      {tab === "why" && (
        <>
          <WhyFailed diagnosis={diagnosis.data} loading={diagnosis.loading} error={diagnosis.error} onRetry={diagnosis.retry} onOpenRun={onOpenRun} />
          <CulpritRanking culprits={culprits.data} loading={culprits.loading} error={culprits.error} onRetry={culprits.retry} onOpenRun={onOpenRun} runStatus={run.status} />
          <SeenBeforeBox diagnosis={diagnosis.data} onOpenRun={onOpenRun} />
        </>
      )}
      {tab === "changes" && (
        <ChangesView changes={changes.data} loading={changes.loading} error={changes.error} onRetry={changes.retry} />
      )}
      {tab === "release" && (
        <ReleaseCheck release={release.data} loading={release.loading} error={release.error} onRetry={release.retry} />
      )}
    </div>
  );
}
