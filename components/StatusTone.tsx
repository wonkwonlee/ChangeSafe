import { forwardRef } from "react";

import type { PolicyStatus, RiskLevel } from "@changesafe/core";

const STATUS_TONE_CLASSNAME: Record<PolicyStatus, string> = {
  PASS: "border-pass/50 bg-pass/10 text-pass",
  WARN: "border-warn/50 bg-warn/10 text-warn",
  BLOCK: "border-block/50 bg-block/10 text-block",
};

/** Renders a policy verdict in the color the design system already reserves for it (never color alone: the status word stays the label). */
export function StatusBadge({ status }: { status: PolicyStatus }) {
  return <span className={`eyebrow rounded border px-2 py-1 ${STATUS_TONE_CLASSNAME[status]}`}>{status}</span>;
}

const RISK_TONE_CLASSNAME: Record<RiskLevel, string> = {
  LOW: "text-pass",
  MEDIUM: "text-warn",
  HIGH: "text-warn",
  CRITICAL: "text-block",
};

/** Renders the derived risk level at a weight matching its stakes, in the matching PASS/WARN/BLOCK-family tone. */
export function RiskValue({ riskLevel }: { riskLevel: RiskLevel | null }) {
  if (!riskLevel) {
    return <p className="mt-2 text-sm text-ink-dim">Not evaluated</p>;
  }
  return <p className={`mt-2 text-2xl font-semibold ${RISK_TONE_CLASSNAME[riskLevel]}`}>{riskLevel}</p>;
}

const PHASE_LABEL: Record<string, string> = {
  READY: "Ready to evaluate",
  ANALYZING: "Evaluating…",
  APPROVAL_REQUIRED: "Approval required",
  BLOCKED: "Blocked",
  ERROR: "Evaluation error",
};

const PHASE_TONE_CLASSNAME: Record<string, string> = {
  READY: "border-edge text-ink-dim",
  ANALYZING: "border-active/50 bg-active/10 text-active",
  APPROVAL_REQUIRED: "border-warn/50 bg-warn/10 text-warn",
  BLOCKED: "border-block/50 bg-block/10 text-block",
  ERROR: "border-block/50 bg-block/10 text-block",
};

const DEFAULT_PHASE_TONE_CLASSNAME = "border-edge text-ink-dim";

/**
 * A workflow phase in human copy and gate-matching tone, with the raw enum
 * kept alongside for operators. Forwards its ref so the surrounding page can
 * move focus here on a phase change instead of onto the scenario `<h1>`,
 * which no longer changes when only the phase does.
 */
export const PhasePill = forwardRef<HTMLSpanElement, { phase: string }>(function PhasePill(
  { phase },
  ref,
) {
  return (
    <span
      className={`mt-2 inline-flex items-center gap-2 rounded border px-2 py-1 text-sm ${PHASE_TONE_CLASSNAME[phase] ?? DEFAULT_PHASE_TONE_CLASSNAME}`}
      data-phase={phase}
      ref={ref}
      tabIndex={-1}
    >
      {PHASE_LABEL[phase] ?? phase}
      <code className="font-mono text-xs opacity-70">{phase}</code>
    </span>
  );
});
