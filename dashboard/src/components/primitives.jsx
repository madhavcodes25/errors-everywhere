// Small shared pieces: badges, states, tooltip, skeleton, evidence links.

import { useState } from "react";
import { confidence as confidenceStrings, errors, tooltips } from "../copy/strings";

// Confidence label — hover or focus the badge for the one-sentence meaning.
export function ConfidenceBadge({ confidence }) {
  const cls = confidence === "high" ? "badge-safe" : confidence === "medium" ? "badge-caution" : "badge-grey";
  return (
    <span className={`badge ${cls}`}>
      <span className="tip" tabIndex={0} aria-label={tooltips.confidence}>
        <span className="tip-body">{tooltips.confidence}</span>
        {confidenceStrings.label}: {confidence}
      </span>
    </span>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div className="skeleton" key={i} style={{ width: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="state">
      <div className="state-title">{title}</div>
      {hint && <p className="state-hint">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state" role="alert">
      <div className="state-title">{errors.unreachable}</div>
      <p className="state-hint">{errors.generic(error && error.message)}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          {errors.retry}
        </button>
      )}
    </div>
  );
}

// A dotted-underline word with a one-sentence explanation on hover/focus.
export function Tip({ text, children }) {
  return (
    <span className="tip" tabIndex={0} aria-label={text}>
      <span className="tip-body">{text}</span>
      {children}
    </span>
  );
}

// Click-to-copy with honest feedback ("Copied").
export function CopyButton({ text, label, copiedLabel }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  return (
    <button className="btn" onClick={copy}>
      {copied ? copiedLabel : label}
    </button>
  );
}

// The run IDs behind a claim, as links to those runs.
export function EvidenceList({ runIds, onOpenRun, label }) {
  if (!runIds || runIds.length === 0) return null;
  return (
    <details className="evidence">
      <summary>{label}</summary>
      <div className="evidence-links">
        {runIds.map((id) => (
          <button key={id} className="link-btn" onClick={() => onOpenRun(id)}>
            {id}
          </button>
        ))}
      </div>
    </details>
  );
}

// The run status in words (never colour alone).
export function StatusWord({ status }) {
  const words = { passed: "Passed", failed: "Failed", errored: "Recorder crashed — run incomplete" };
  return <span className={`status-${status}`}>{words[status] || status}</span>;
}
