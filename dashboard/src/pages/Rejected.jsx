// "Rejected events": everything the server refused, with a plain reason and
// a one-line fix for each.

import strings, { rejectedPage } from "../copy/strings";
import { useApi } from "../hooks";
import { api } from "../api";
import { EmptyState, ErrorState, Skeleton } from "../components/primitives";

export function RejectedPage({ refreshKey }) {
  const { data, loading, error, retry } = useApi(() => api.rejectedEvents(20), [refreshKey]);

  if (loading) return <Skeleton lines={3} />;
  if (error) return <ErrorState error={error} onRetry={retry} />;

  const events = (data && data.events) || [];
  if (events.length === 0)
    return (
      <EmptyState title={rejectedPage.emptyTitle} hint={rejectedPage.emptyHint} />
    );

  return (
    <div data-testid="rejected-list">
      {events.map((event, i) => (
        <article key={i} className="panel" style={{ padding: 16 }}>
          <div className="verdict-line">
            <span className="badge badge-block">Rejected</span>
            <span className="muted" style={{ fontSize: "var(--fs-13)" }}>
              {new Date(event.receivedAt).toLocaleString()}
            </span>
          </div>
          <p style={{ margin: "8px 0 4px", fontWeight: 600 }}>{event.reason}</p>
          <p className="muted" style={{ margin: "0 0 8px" }}>{rejectedPage.fix(event.reason)}</p>
          <details className="evidence">
            <summary>Show what we received (names only, secrets removed)</summary>
            <pre className="mono" style={{ fontSize: "var(--fs-12)", overflowX: "auto" }}>
              {JSON.stringify(event.rawBody, null, 2).slice(0, 600)}
            </pre>
          </details>
        </article>
      ))}
    </div>
  );
}
