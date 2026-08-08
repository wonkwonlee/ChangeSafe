import { forwardRef } from "react";

import type { PolicyFinding, PolicyStatus, RiskLevel } from "@changesafe/core";

// Solid fill, not a translucent tint: a badge's background must never depend
// on what tint (if any) the card behind it is also applying. Two identical
// translucent layers stacking (a card's bg-block/10 plus a badge's own
// bg-block/10 inside it) silently doubled the effective opacity and dropped
// BLOCK's text contrast to 3.75:1 — invisible in isolation, only caught by
// measuring the composited result. An opaque badge can't stack with
// anything behind it, so its contrast is fixed at ~6.2–8.0:1 regardless of
// context, verified against all three status colors.
const STATUS_TONE_CLASSNAME: Record<PolicyStatus, string> = {
  PASS: "bg-pass text-action-primary-foreground",
  WARN: "bg-warn text-action-primary-foreground",
  BLOCK: "bg-block text-action-primary-foreground",
};

/** Renders a policy verdict in the color the design system already reserves for it (never color alone: the status word stays the label). */
export function StatusBadge({ status }: { status: PolicyStatus }) {
  return <span className={`eyebrow rounded px-2 py-1 ${STATUS_TONE_CLASSNAME[status]}`}>{status}</span>;
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

const FINDING_CARD_TONE_CLASSNAME: Record<PolicyStatus, string> = {
  PASS: "border-edge bg-canvas",
  WARN: "border-warn/50 bg-warn/10",
  BLOCK: "border-l-4 border-l-block border-block/60 bg-block/10",
};

const SEVERITY_ORDER: Record<PolicyStatus, number> = { BLOCK: 0, WARN: 1, PASS: 2 };

/**
 * A BLOCK finding is categorically different from a WARN or PASS one — it
 * makes approval structurally impossible, not merely discouraged. The list
 * sorts findings severity-first and gives BLOCK cards distinct chrome (not
 * just a colored status word) so that difference reads at a glance, not only
 * on close reading.
 */
export function FindingsList({ findings, ariaLabel }: { findings: PolicyFinding[]; ariaLabel: string }) {
  const blocking = findings.filter((finding) => finding.status === "BLOCK").length;
  const warning = findings.filter((finding) => finding.status === "WARN").length;
  const passing = findings.length - blocking - warning;
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status]);

  return (
    <div className="mt-3">
      <p className="text-xs text-ink-faint">
        {blocking} blocking · {warning} warning{warning === 1 ? "" : "s"} · {passing} passing
      </p>
      <ul className="mt-2 space-y-2" aria-label={ariaLabel}>
        {sorted.map((finding) => (
          <li
            className={`rounded border p-3 text-sm ${FINDING_CARD_TONE_CLASSNAME[finding.status]}`}
            id={`finding-${finding.policyId}`}
            key={finding.policyId}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs">{finding.policyId}</span>
              <StatusBadge status={finding.status} />
            </div>
            <p className="mt-2 font-medium text-ink">{finding.title}</p>
            <p className="mt-1 text-ink-dim">{finding.explanation}</p>
            {finding.affectedResources.length > 0 ? (
              <p className="mt-2 text-xs text-ink-faint">Affected: {finding.affectedResources.join(", ")}</p>
            ) : null}
            {finding.remediation ? (
              <p className="mt-2 border-t border-edge pt-2 text-xs text-ink-dim">Remediation: {finding.remediation}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
