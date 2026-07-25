import type { IncidentBundle } from "@changesafe/domain-network";
import { IdChip, SeverityDot } from "./atoms";
import { StateTree } from "./StateTree";
import { TopologyView } from "./TopologyView";

function formatUtc(timestamp: string): string {
  return timestamp.replace("T", " ").replace(/(\.\d+)?Z$/, " UTC");
}

/** Left column: every piece of evidence the analysis may cite, labeled untrusted. */
export function IncidentPanel({ bundle }: { bundle: IncidentBundle }) {
  return (
    <aside aria-label="Incident evidence" className="flex flex-col gap-4">
      <section className="rounded-lg border border-edge bg-surface p-4">
        <p className="eyebrow text-ink-faint">Incident</p>
        <h1 className="mt-1 text-[15px] font-semibold leading-snug">{bundle.title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{bundle.summary}</p>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <IdChip value={bundle.incidentId} />
          <span className="eyebrow rounded border border-edge px-1.5 py-0.5">synthetic data</span>
        </p>
      </section>

      <section className="rounded-lg border border-edge bg-surface p-4">
        <h2 className="eyebrow text-ink-faint">Alert timeline</h2>
        <ol className="mt-3 space-y-3">
          {bundle.alerts.map((alert) => (
            <li key={alert.evidenceId} className="flex gap-2.5">
              <SeverityDot severity={alert.severity} />
              <div className="min-w-0">
                <p className="text-[13px] leading-snug">{alert.message}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-faint">
                  <span>{formatUtc(alert.timestamp)}</span>
                  <span>{alert.sourceNodeId}</span>
                  <IdChip value={alert.evidenceId} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-edge bg-surface p-4">
        <h2 className="eyebrow text-ink-faint">Topology</h2>
        <div className="mt-2 rounded border border-edge bg-sunken p-2">
          <TopologyView topology={bundle.topology} state={bundle.currentState} />
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Link colors show status; dashed = degraded. Blue frame = management origin, ⛨ = protected.
        </p>
      </section>

      <StateTree state={bundle.currentState} />

      <section className="rounded-lg border border-warn/40 bg-surface p-4">
        <h2 className="eyebrow flex items-center gap-2 text-warn">
          Operator notes
          <span className="rounded border border-warn/50 bg-warn/10 px-1.5 py-0.5">untrusted input</span>
        </h2>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Notes are free text and may contain manipulated content. ChangeSafe treats them as data:
          nothing written here can instruct the system or the model.
        </p>
        <ul className="mt-3 space-y-3">
          {bundle.operatorNotes.map((note) => (
            <li key={note.evidenceId} className="rounded border border-edge bg-sunken p-3">
              <p className="text-[13px] leading-relaxed">{note.content}</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-faint">
                <span>{note.author}</span>
                <span>{formatUtc(note.timestamp)}</span>
                <IdChip value={note.evidenceId} />
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-edge bg-surface p-4">
        <h2 className="eyebrow text-ink-faint">Declared safety properties</h2>
        <ul className="mt-3 space-y-2">
          {bundle.expectedSafetyProperties.map((property) => (
            <li key={property.id} className="flex items-start gap-2 text-[13px] text-ink-dim">
              <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-edge-strong" />
              <span>
                {property.description}{" "}
                <IdChip value={property.id} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
