import type { SimulationResult } from "@/lib/domain/schemas";
import { IdChip } from "./atoms";

function formatValue(value: unknown): string {
  if (value === null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SimulationPanel({ simulation }: { simulation: SimulationResult }) {
  const allSatisfied = simulation.safetyProperties.every((property) => property.satisfied);
  return (
    <div className="rounded-lg border border-edge bg-surface">
      <p className="border-b border-edge px-4 py-3 text-[13px] leading-relaxed text-ink-dim">
        {simulation.summary}
      </p>
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
        <section aria-label="Applied changes" className="min-w-0">
          <h3 className="eyebrow text-ink-faint">Applied to sandbox copy</h3>
          <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[360px] text-left font-mono text-[11px]">
            <thead>
              <tr className="text-ink-faint">
                <th className="py-1 pr-3 font-normal">path</th>
                <th className="py-1 pr-3 font-normal">before</th>
                <th className="py-1 font-normal">after</th>
              </tr>
            </thead>
            <tbody>
              {simulation.diff.map((entry) => (
                <tr key={`${entry.op}-${entry.path}`} className="border-t border-edge align-top text-ink-dim">
                  <td className="py-1.5 pr-3 break-all text-ink">{entry.path}</td>
                  <td className="py-1.5 pr-3 break-all text-block/90">{formatValue(entry.before)}</td>
                  <td className="py-1.5 break-all text-pass/90">{formatValue(entry.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="mt-3 flex flex-wrap gap-1.5">
            {simulation.changedResourceIds.map((resource) => (
              <IdChip key={resource} value={resource} />
            ))}
          </p>
        </section>
        <section aria-label="Safety properties after change">
          <h3 className="eyebrow text-ink-faint">Safety properties after change</h3>
          <ul className="mt-2 space-y-2">
            {simulation.safetyProperties.map((property) => (
              <li key={property.propertyId} className="flex items-start gap-2 text-[13px]">
                <span
                  aria-hidden
                  className={`mt-0.5 font-mono text-[13px] ${property.satisfied ? "text-pass" : "text-block"}`}
                >
                  {property.satisfied ? "✓" : "✗"}
                </span>
                <span className="text-ink-dim">
                  {property.detail} <IdChip value={property.propertyId} />
                </span>
              </li>
            ))}
          </ul>
          <p
            className={`mt-3 rounded border px-3 py-2 text-[12px] ${
              allSatisfied ? "border-pass/40 text-pass" : "border-warn/50 text-warn"
            }`}
          >
            {allSatisfied
              ? "All declared safety properties remain satisfied in the sandbox."
              : "Some declared safety properties are not satisfied — review before acting on this result."}
          </p>
        </section>
      </div>
    </div>
  );
}
