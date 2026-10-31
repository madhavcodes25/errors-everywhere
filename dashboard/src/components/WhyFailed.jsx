// Run detail sections: "Why it failed" — diagnosis cards, then the Culprit
// Ranking hero, then the seen-before box with "Copy this fix".

import strings, { verdicts, culprits as culpritStrings, seenBefore as seenStrings } from "../copy/strings.js";
import { ConfidenceBadge, CopyButton, ErrorState, Skeleton } from "./primitives";

const VERDICT_WORD = {
  new_regression: verdicts.new_regression,
  flaky: verdicts.flaky,
  environment_problem: verdicts.environment_problem,
  long_standing_break: verdicts.long_standing_break,
  unknown: verdicts.unknown,
};
const VERDICT_LONG = {
  new_regression: verdicts.new_regression_long,
  flaky: verdicts.flaky_long,
  environment_problem: verdicts.environment_problem_long,
  long_standing_break: verdicts.long_standing_break_long,
  unknown: verdicts.unknown_long,
};

// One failed test: verdict word, confidence, plain explanation, evidence.
function DiagnosisCard({ test, onOpenRun }) {
  const { evidence = {} } = test;
  const history = evidence.history || [];
  const risk = evidence.fileRiskRates || {};
  return (
    <article className="test-card fade-up" data-testid="diagnosis-card">
      <div className="verdict-line">
        <span className={`verdict-word ${test.verdict === "unknown" ? "muted" : ""}`}>{VERDICT_WORD[test.verdict] || test.verdict}</span>
        <ConfidenceBadge confidence={test.confidence} />
        <span className="test-file">{test.file}</span>
      </div>
      <p className="muted" style={{ margin: "2px 0 0", fontSize: "var(--fs-13)" }}>{VERDICT_LONG[test.verdict] || ""}</p>
      <h3 className="test-name">{test.name}</h3>
      <p className="test-explanation prose">{test.explanation}</p>

      {Object.keys(risk).length > 0 && (
        <div>
          {Object.entries(risk).map(([file, r]) => (
            <div key={file} className="risk-row">
              <span className="mono">{file}</span>
              <span className={r.failRate > 0.4 ? "" : "muted"}>
                failed in {Math.round(r.failRate * 100)} of 100 similar runs ({r.failures} of {r.runs})
              </span>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <details className="evidence">
          <summary>{history.length} earlier runs</summary>
          <ul className="history-list">
            {history.map((h) => (
              <li key={h.runId}>
                <span className={h.status === "passed" ? "status-passed" : "status-failed"}>
                  {h.status === "passed" ? "Passed" : "Failed"}
                </span>
                <button className="link-btn" onClick={() => onOpenRun(h.runId)}>{h.runId}</button>
                <span className="mono muted">{String(h.commitSha).slice(0, 7)}</span>
                <span className="muted history-time">{new Date(h.startedAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

// The hero: ranked commits with bars, plain reasons, expandable evidence.
export function CulpritRanking({ culprits, loading, error, onRetry, onOpenRun, runStatus }) {
  if (loading) return <div className="panel culprit-panel"><Skeleton lines={3} /></div>;
  if (error) return <div className="panel culprit-panel"><ErrorState error={error} onRetry={onRetry} /></div>;

  const { candidates = [], confidence, note } = culprits || {};
  if (candidates.length === 0) {
    return (
      <section className="panel culprit-panel">
        <h2 className="panel-title">{culpritStrings.heading}</h2>
        <p className="panel-note">
          {runStatus === "passed" ? culpritStrings.emptyPassed : note || culpritStrings.emptyNoCommits}
        </p>
      </section>
    );
  }

  const max = Math.max(...candidates.map((c) => c.matchPercent), 1);
  return (
    <section className="panel culprit-panel" data-testid="culprit-panel" aria-label="Culprit ranking">
      <div className="panel-head">
        <h2 className="panel-title">{culpritStrings.heading}</h2>
        <ConfidenceBadge confidence={confidence} />
      </div>
      {note && <p className="panel-note">{note}</p>}
      <div style={{ marginTop: 10 }}>
        {candidates.map((c) => (
          <div key={c.sha} className="culprit" data-rank={c.rank}>
            <div className="culprit-top-line">
              <span className={`culprit-rank ${c.rank === 1 ? "first" : ""}`}>#{c.rank}</span>
              <span className="culprit-sha">{String(c.sha).slice(0, 7)}</span>
              <span className="culprit-msg" title={c.message}>{c.message}</span>
              <span className="culprit-author">{c.author}</span>
              <span className="culprit-pct">{c.matchPercent}%</span>
            </div>
            <div className="bar-track">
              <div
                className={`bar-fill ${c.rank === 1 ? "top" : ""}`}
                style={{ width: `${Math.max((c.matchPercent / max) * 100, c.matchPercent > 0 ? 2 : 0)}%` }}
              />
            </div>
            <div className="culprit-files">{(c.files || []).join(", ")}</div>
            {c.reasons.length > 0 && (
              <ul className="culprit-reasons">
                {c.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            )}
            {c.evidenceRunIds.length > 0 && (
              <details className="evidence">
                <summary>{culpritStrings.evidence(c.evidenceRunIds.length)}</summary>
                <div className="evidence-links">
                  {c.evidenceRunIds.map((id) => (
                    <button key={id} className="link-btn" onClick={() => onOpenRun(id)}>
                      {id}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// "Seen N times before" + what the fix touched, with a one-click copy.
export function SeenBeforeBox({ diagnosis, onOpenRun }) {
  const tests = (diagnosis && diagnosis.tests) || [];
  const withSeen = tests.filter((t) => t.evidence && t.evidence.seenBefore && t.evidence.seenBefore.count > 0 && t.evidence.seenBefore.fixedBy);
  if (withSeen.length === 0) return null;

  return (
    <section className="panel" data-testid="seen-before">
      <h2 className="panel-title">{seenStrings.heading(withSeen[0].evidence.seenBefore.count)}</h2>
      {withSeen.map((t) => {
        const seen = t.evidence.seenBefore;
        const fixText = `${seenStrings.fixedBy(seen.fixedBy.runId)} — ${seen.fixedBy.files.join(", ")}`;
        return (
          <div key={t.name} className="fixed-box">
            <div className="fixed-title">
              {t.name} · {seenStrings.lastSeen(seen.lastSeenRunId)}
            </div>
            <div>{seenStrings.fixedBy(seen.fixedBy.runId)}</div>
            <div className="fixed-files">{seen.fixedBy.files.join(", ")}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <CopyButton text={fixText} label={seenStrings.copy} copiedLabel={culpritStrings.copied} />
              <button className="link-btn" onClick={() => onOpenRun(seen.fixedBy.runId)}>
                {seen.fixedBy.runId}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function WhyFailed({ diagnosis, loading, error, onRetry, onOpenRun }) {
  if (loading) return <Skeleton lines={4} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const tests = (diagnosis && diagnosis.tests) || [];
  if (tests.length === 0) {
    return (
      <p className="prose muted">
        {(diagnosis && diagnosis.note) || strings.runDetail.allPassed}
      </p>
    );
  }
  return (
    <div data-testid="why-failed">
      {diagnosis.note && <p className="prose culprit-note">{diagnosis.note}</p>}
      {tests.map((test) => (
        <DiagnosisCard key={test.name} test={test} onOpenRun={onOpenRun} />
      ))}
    </div>
  );
}
