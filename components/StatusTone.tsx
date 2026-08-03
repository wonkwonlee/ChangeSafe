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
