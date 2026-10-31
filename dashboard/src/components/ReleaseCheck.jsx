// Release check: the big serif verdict ("Safe to release" / "Be careful" /
// "Not safe to release"), the score, every reason with points and real
// evidence, and the recommendation sentence.

import strings, { release as r } from "../copy/strings";
import { ConfidenceBadge, ErrorState, Skeleton } from "./primitives";

const LEVEL_CLASS = { LOW: "verdict-safe", MEDIUM: "verdict-caution", HIGH: "verdict-block" };

export function ReleaseCheck({ release, loading, error, onRetry }) {
  if (loading) return <Skeleton lines={4} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!release || release.score === undefined)
    return <p className="muted">This project has no runs yet, so there is nothing to score.</p>;

  return (
    <div data-testid="release-check" className="fade-up">
      <div className="verdict-hero" style={{ marginBottom: 12 }}>
        <div className={`display display-page ${LEVEL_CLASS[release.level] || ""}`}>
          {r.levels[release.level] || release.level}
          {release.blocked && (
            <span className="badge badge-block" style={{ marginLeft: 16, verticalAlign: "super", fontSize: "var(--fs-13)" }}>
              {r.blocked}
            </span>
          )}
        </div>
        <p className="sentence muted" style={{ maxWidth: "var(--max-text)" }}>
          {release.recommendation}
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="mono">{r.score(release.score)}</span>
          <ConfidenceBadge confidence={release.confidence} />
        </div>
      </div>

      <div className="label">Why</div>
      <ul className="reason-list">
        {(release.reasons || []).map((reason, i) => (
          <li key={i} className="reason">
            <span className="reason-points">+{reason.points}</span>
            <span>{reason.text}</span>
          </li>
        ))}
        {(release.reasons || []).length === 0 && (
          <li className="reason">
            <span className="muted">Nothing increases the risk right now.</span>
          </li>
        )}
      </ul>
      <p className="muted" style={{ fontSize: "var(--fs-13)" }}>
        {r.basedOn(release.runId)} on branch {release.branch}
      </p>
    </div>
  );
}
