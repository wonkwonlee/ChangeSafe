import type { AnalysisMode, ChangeProposal, DiffEntry, FixtureProvenance } from "@changesafe/core";
import type { IncidentBundle } from "@changesafe/domain-network";
import { applyOperations } from "@changesafe/domain-network";
import { IdChip } from "./atoms";
import type { AnalysisMeta } from "./useWorkflow";

const PROVENANCE_LABEL: Record<FixtureProvenance, string> = {
  captured_gpt_5_6: "Captured GPT-5.6 replay",
  authored_red_team: "Authored red-team fixture — not model output",
  authored_synthetic: "Authored replay fixture — not model output",
};

function OpBadge({ op }: { op: "add" | "replace" | "remove" }) {
  const styles = {
    add: "text-pass border-pass/40",
    replace: "text-active border-active/40",
    remove: "text-block border-block/40",
  } as const;
  return <span className={`eyebrow rounded border px-1.5 py-0.5 ${styles[op]}`}>{op}</span>;
}

function formatValue(value: unknown): string {
  if (value === null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Before/after preview computed by the same transactional engine used everywhere. */
function DiffPreview({ diff }: { diff: DiffEntry[] }) {
  return (
    <table className="w-full min-w-[420px] text-left font-mono text-[11px]">
      <caption className="eyebrow mb-1 caption-top text-left text-ink-faint">
        Before / after (sandbox preview)
      </caption>
      <thead>
        <tr className="text-ink-faint">
          <th className="py-1 pr-3 font-normal">path</th>
          <th className="py-1 pr-3 font-normal">before</th>
          <th className="py-1 font-normal">after</th>
        </tr>
      </thead>
      <tbody>
        {diff.map((entry) => (
          <tr key={`${entry.op}-${entry.path}`} className="align-top border-t border-edge text-ink-dim">
            <td className="py-1.5 pr-3 break-all text-ink">{entry.path}</td>
            <td className="py-1.5 pr-3 break-all text-block/90">{formatValue(entry.before)}</td>
            <td className="py-1.5 break-all text-pass/90">{formatValue(entry.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProposalPanel({
  bundle,
  proposal,
  mode,
  provenance,
  meta,
}: {
  bundle: IncidentBundle;
  proposal: ChangeProposal;
  mode: AnalysisMode;
  provenance: FixtureProvenance | null;
  meta: AnalysisMeta | null;
}) {
  let diff: DiffEntry[] | null = null;
  try {
    diff = applyOperations(bundle.currentState, proposal.operations).diff;
  } catch {
    diff = null; // preview unavailable; the safety gate will explain why
  }

  const confidencePct = Math.round(proposal.diagnosis.confidence * 100);

  return (
    <div className="rounded-lg border border-ai/30 bg-surface">
      <div className="border-b border-edge px-4 py-3">
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
          {mode === "live" ? (
            <span className="eyebrow rounded border border-ai/40 px-1.5 py-0.5 text-ai">
              live gpt-5.6 output
            </span>
          ) : provenance ? (
            <span className="eyebrow rounded border border-ai/40 px-1.5 py-0.5 text-ai">
              replay · {PROVENANCE_LABEL[provenance]}
            </span>
          ) : null}
          {meta?.fixtureId ? <IdChip value={meta.fixtureId} /> : null}
        </p>
        <p className="mt-2 text-[14px] font-medium leading-relaxed">{proposal.summary}</p>
        {meta?.fixtureNotes ? (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{meta.fixtureNotes}</p>
        ) : null}
      </div>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
        <section aria-label="Diagnosis">
          <h3 className="eyebrow text-ink-faint">Diagnosis</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-ink">{proposal.diagnosis.likelyCause}</p>
          <div className="mt-3">
            <p className="flex items-baseline gap-2 text-[11px] text-ink-faint">
              <span className="eyebrow">Model confidence</span>
              <span className="font-mono text-ink-dim">{confidencePct}%</span>
              <span>advisory only — never used by the safety gate</span>
            </p>
            <div className="mt-1 h-1 w-full max-w-56 rounded bg-sunken" aria-hidden>
              <div className="h-1 rounded bg-ai/60" style={{ width: `${confidencePct}%` }} />
            </div>
          </div>
          <div className="mt-3">
            <p className="eyebrow text-ink-faint">Cited evidence</p>
            <p className="mt-1.5 flex flex-wrap gap-1.5">
              {proposal.diagnosis.evidenceIds.map((evidenceId) => (
                <IdChip key={evidenceId} value={evidenceId} />
              ))}
            </p>
          </div>
          {proposal.diagnosis.assumptions.length > 0 ? (
            <div className="mt-3">
              <p className="eyebrow text-ink-faint">Stated assumptions</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12px] text-ink-dim">
                {proposal.diagnosis.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section aria-label="Proposed operations">
          <h3 className="eyebrow text-ink-faint">Declarative operations</h3>
          <ol className="mt-2 space-y-2.5">
            {proposal.operations.map((operation, index) => (
              <li key={`${operation.path}-${index}`} className="rounded border border-edge bg-sunken p-2.5">
                <p className="flex flex-wrap items-center gap-2">
                  <OpBadge op={operation.op} />
                  <code className="break-all font-mono text-[11px] text-ink">{operation.path}</code>
                </p>
                {operation.value !== null ? (
                  <p className="mt-1 font-mono text-[11px] text-ink-dim">
                    value: {formatValue(operation.value)}
                  </p>
                ) : null}
                <p className="mt-1 text-[12px] text-ink-dim">{operation.reason}</p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {operation.evidenceIds.map((evidenceId) => (
                    <IdChip key={evidenceId} value={evidenceId} />
                  ))}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="eyebrow text-ink-faint">Rollback plan</p>
              {proposal.rollbackOperations.length > 0 ? (
                <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-ink-dim">
                  {proposal.rollbackOperations.map((operation, index) => (
                    <li key={`${operation.path}-${index}`} className="break-all">
                      {operation.op} {operation.path}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[12px] text-block">none provided</p>
              )}
            </div>
            <div>
              <p className="eyebrow text-ink-faint">Verification steps</p>
              <ul className="mt-1.5 space-y-1 text-[12px] text-ink-dim">
                {proposal.verificationSteps.map((step, index) => (
                  <li key={index}>
                    <span className="eyebrow mr-1.5 text-ink-faint">{step.kind}</span>
                    {step.description}
                  </li>
                ))}
                {proposal.verificationSteps.length === 0 ? (
                  <li className="text-warn">none provided</li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>
      </div>

      {diff ? (
        <div className="overflow-x-auto border-t border-edge px-4 py-4">
          <DiffPreview diff={diff} />
        </div>
      ) : (
        <p className="border-t border-edge px-4 py-3 text-[12px] text-ink-faint">
          Before/after preview unavailable: the operations do not apply cleanly to the current
          state. The safety gate below explains the violations.
        </p>
      )}
    </div>
  );
}
