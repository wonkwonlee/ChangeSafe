/**
 * Shown when `?scenario=<id>` names an id outside the bundled corpus. Without
 * this, the workbench silently falls back to its default example while the
 * URL still displays the unrecognized id — a link recipient sees a different
 * scenario than the one the link claimed, contradicting the project's own
 * provenance-honesty invariant (replay is never silently substituted).
 */
export function UnknownScenarioNotice({
  requestedId,
  fallbackLabel,
  onDismiss,
}: {
  requestedId: string;
  fallbackLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-3 flex items-start justify-between gap-3 rounded border border-warn/50 bg-warn/10 p-3 text-sm text-warn" role="status">
      <p>
        No example named <code className="font-mono">{requestedId}</code> in this bundled corpus.
        Showing <span className="font-medium">{fallbackLabel}</span> instead.
      </p>
      <button
        aria-label="Dismiss notice"
        className="shrink-0 rounded border border-warn/50 px-2 py-1 text-xs hover:bg-warn/10"
        onClick={onDismiss}
        type="button"
      >
        Dismiss
      </button>
    </div>
  );
}
