// Timeline (home): the release verdict for the latest run in big display
// type, then every run newest-first. New runs slide in live via /stream.

import strings, { release as releaseStrings } from "../copy/strings";
import { EmptyState, ErrorState, Skeleton } from "./primitives";
import { WelcomeSteps } from "./WelcomeSteps";

const LEVEL_CLASS = { LOW: "verdict-safe", MEDIUM: "verdict-caution", HIGH: "verdict-block" };
const STATUS_WORD = { passed: "Passed", failed: "Failed", errored: "Errored" };
const STATUS_CLASS = { passed: "status-passed", failed: "status-failed", errored: "status-errored" };

// The big verdict for the latest run: the word, one short reason, one action.
export function VerdictHero({ release, latestRun, loading, error, onRetry, onOpenRun }) {
  if (loading) {
    return (
      <div className="verdict-hero" aria-hidden="true" data-state="loading">
        <div className="skeleton" style={{ height: 72, width: 380 }} />
        <div className="skeleton" style={{ height: 22, width: 300 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="verdict-hero" data-state="error">
        <div className="label">{error.message}</div>
      </div>
    );
  }
  if (!release) {
    return (
      <div className="verdict-hero" data-state="empty">
        <div className="label">—</div>
      </div>
    );
  }

  const word = releaseStrings.levels[release.level] || release.level;
  const latestFailed = latestRun && latestRun.status === "failed";
  const shortReason =
    (release.reasons && release.reasons[0] && release.reasons[0].text) || release.recommendation;

  return (
    <section className="verdict-hero fade-up" data-testid="verdict-hero">
      <div className="label">{releaseStrings.heading}</div>
      <div className={`display display-hero word ${LEVEL_CLASS[release.level] || ""}`}>
        {word}
        {release.blocked && (
          <span className="badge badge-block hero-block">{releaseStrings.blocked}</span>
        )}
      </div>
      <p className="sentence">{shortReason}</p>
      <button
        className="btn btn-primary"
        onClick={() => onOpenRun(latestRun._id)}
      >
        {latestFailed ? releaseStrings.seeWhy : releaseStrings.checklist}
      </button>
      <div className="hero-run mono">{releaseStrings.basedOn(latestRun._id)}</div>
    </section>
  );
}

export function RunRow({ run, selected, onSelect }) {
  return (
    <>
      {run.status === "errored" && <div className="errored-label">{strings.timeline.erroredLabel}</div>}
      <li>
        <button
          className={`run-row ${selected ? "selected" : ""}`}
          onClick={() => onSelect(run._id)}
          title={(run.commits || []).map((c) => c.message).join(" · ")}
        >
          <span className={`dot dot-${run.status}`} aria-hidden="true" />
          <span className={`run-status-word ${STATUS_CLASS[run.status]}`}>{STATUS_WORD[run.status]}</span>
          <span className="run-sha">{String(run.commitSha).slice(0, 7)}</span>
          <span className="run-author">{run.author}</span>
          <span className="run-branch muted">{run.branch}</span>
          <span className="run-time" title={new Date(run.startedAt).toLocaleString()}>
            {new Date(run.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        </button>
      </li>
    </>
  );
}

export function Timeline({ runs, loading, error, onRetry, onSelectRun, selectedRunId, filter, welcome, onWelcomeSkip, onSampleData, sampleActive }) {
  if (loading) return <Skeleton lines={6} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const visible = runs.filter((run) => {
    if (!filter) return true;
    const haystack = [run.commitSha, run.author, run.branch, ...(run.commits || []).map((c) => c.message)]
      .join(" ")
      .toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  return (
    <div>
      {welcome && (
        <WelcomeSteps onSkip={onWelcomeSkip} onSampleData={onSampleData} sampleActive={sampleActive} />
      )}
      {runs.length === 0 ? (
        <EmptyState
          title={strings.timeline.emptyTitle}
          action={
            <button className="btn btn-primary" onClick={onSampleData}>
              {strings.timeline.loadSample}
            </button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState title={`Nothing matches "${filter}".`} />
      ) : (
        <ol className="run-list" data-testid="timeline">
          {visible.map((run) => (
            <RunRow key={run._id} run={run} selected={selectedRunId === run._id} onSelect={onSelectRun} />
          ))}
        </ol>
      )}
    </div>
  );
}
