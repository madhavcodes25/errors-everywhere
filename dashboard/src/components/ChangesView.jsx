// "What changed" — side-by-side with the last good run. One-line summary on
// top, then commits, files, packages (major bumps in the block colour),
// environment settings (names only), tests, and the duration change.

import strings, { changes as c } from "../copy/strings";
import { ConfidenceBadge, EmptyState, ErrorState, Skeleton } from "./primitives";

function Chip({ label, major, tag }) {
  return (
    <li className={major ? "chip chip-major" : "chip"}>
      {label}
      {major && tag && <span className="chip-tag">{tag}</span>}
    </li>
  );
}

function Chips({ items, none }) {
  if (!items || items.length === 0) return <span className="none">{none || c.none}</span>;
  return (
    <ul className="chip-list">
      {items.map((item, i) => (
        <Chip key={i} {...item} />
      ))}
    </ul>
  );
}

export function ChangesView({ changes, loading, error, onRetry }) {
  if (loading) return <Skeleton lines={4} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const d = changes || {};
  if (!d.againstRunId) {
    return (
      <EmptyState
        title={c.noBaseline}
        hint={d.note}
      />
    );
  }

  const deps = d.dependencies || { added: [], removed: [], changed: [] };
  const env = (d.config && d.config.envKeys) || { added: [], removed: [] };
  const missing = (d.config && d.config.missingEnvKeys) || { introduced: [], resolved: [] };
  const tests = d.tests || {};
  const duration = d.duration || {};
  const commitCount = (d.commits || []).length;
  const fileCount = (d.changedFiles || []).length;

  return (
    <div data-testid="changes-view">
      <p className="prose" style={{ marginTop: 0 }}>
        {c.oneLine(commitCount, fileCount)}
      </p>
      <div className="against-bar">
        <span>
          <span className="label">{c.against}</span>{" "}
          <span className="mono">{String((d.evidence && d.evidence.fromCommit) || "").slice(0, 7)}</span>{" "}
          <span className="muted">({d.againstRunId})</span>
        </span>
        <span aria-hidden="true">→</span>
        <span>
          <span className="label">{c.thisRun}</span>{" "}
          <span className="mono">{String((d.evidence && d.evidence.toCommit) || "").slice(0, 7)}</span>
        </span>
        <ConfidenceBadge confidence={d.confidence} />
      </div>

      <div className="changes-grid">
        <section className="changes-section">
          <h3>{c.commits}</h3>
          {(d.commits || []).length === 0 ? (
            <span className="none">{c.none}</span>
          ) : (
            <ul className="commit-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {d.commits.map((commit) => (
                <li key={commit.sha} style={{ padding: "3px 0" }}>
                  <span className="mono muted">{String(commit.sha).slice(0, 7)}</span> {commit.message}{" "}
                  <span className="muted">— {commit.author}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="changes-section">
          <h3>{c.files}</h3>
          <Chips items={(d.changedFiles || []).map((f) => ({ label: f }))} />
        </section>

        <section className="changes-section">
          <h3>{c.dependencies}</h3>
          <Chips
            items={deps.changed.map((dep) => ({
              label: `${dep.name} ${dep.from} → ${dep.to}`,
              major: dep.major,
              tag: dep.major ? c.major : null,
            }))}
          />
          <Chips items={deps.added.map((dep) => ({ label: `+ ${dep.name} ${dep.version}` }))} />
          <Chips items={deps.removed.map((dep) => ({ label: `− ${dep.name} ${dep.version}` }))} />
          {deps.changed.length + deps.added.length + deps.removed.length === 0 && <span className="none">{c.none}</span>}
        </section>

        <section className="changes-section">
          <h3>{c.env}</h3>
          <div className="mini-heading">Appeared</div>
          <Chips items={env.added.map((key) => ({ label: key }))} none="none" />
          <div className="mini-heading">Disappeared</div>
          <Chips items={env.removed.map((key) => ({ label: key }))} none="none" />
          <div className="mini-heading">Missing, but required</div>
          <Chips items={missing.introduced.map((key) => ({ label: key }))} none="none" />
        </section>

        <section className="changes-section">
          <h3>{c.tests}</h3>
          <div className="mini-heading">{c.newlyFailing}</div>
          <Chips items={(tests.newlyFailing || []).map((name) => ({ label: name }))} none="none" />
          <div className="mini-heading">{c.newlyPassing}</div>
          <Chips items={(tests.newlyPassing || []).map((name) => ({ label: name }))} none="none" />
          <div className="mini-heading">{c.muchSlower}</div>
          <Chips items={(tests.muchSlower || []).map((t) => ({ label: `${t.name} (${(t.previousMs / 1000).toFixed(1)}s → ${(t.currentMs / 1000).toFixed(1)}s)` }))} none="none" />
        </section>

        <section className="changes-section">
          <h3>{c.duration}</h3>
          {duration.previousMs == null ? (
            <span className="none">{c.none}</span>
          ) : (
            <span className="mono">
              {(duration.previousMs / 1000).toFixed(1)}s → {(duration.currentMs / 1000).toFixed(1)}s{" "}
              <span className={duration.deltaMs > 0 ? "status-failed" : "status-passed"}>
                ({duration.deltaMs >= 0 ? "+" : ""}
                {(duration.deltaMs / 1000).toFixed(1)}s)
              </span>
            </span>
          )}
        </section>
      </div>
    </div>
  );
}
