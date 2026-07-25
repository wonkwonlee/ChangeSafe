import type { PolicyFinding, RiskLevel } from "@changesafe/core";
import { IdChip, RiskBadge, StatusPill } from "./atoms";

/**
 * The deterministic verdict panel. Hard-edged and neutral by design: this is
 * the machine's ruling, visually distinct from the violet-tagged AI proposal.
 */
export function PolicyGate({
  findings,
  riskLevel,
}: {
  findings: PolicyFinding[];
  riskLevel: RiskLevel;
}) {
  const counts = {
    PASS: findings.filter((finding) => finding.status === "PASS").length,
    WARN: findings.filter((finding) => finding.status === "WARN").length,
    BLOCK: findings.filter((finding) => finding.status === "BLOCK").length,
  };

  return (
    <div className="rounded-lg border-2 border-edge-strong bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3">
        <p className="font-mono text-[12px] text-ink-dim" role="status" aria-live="polite">
          <span className="text-pass">{counts.PASS} PASS</span>
          <span className="mx-1.5 text-ink-faint">·</span>
          <span className="text-warn">{counts.WARN} WARN</span>
          <span className="mx-1.5 text-ink-faint">·</span>
          <span className="text-block">{counts.BLOCK} BLOCK</span>
        </p>
        <span className="ml-auto">
          <RiskBadge level={riskLevel} />
        </span>
      </div>
      <p className="border-b border-edge px-4 py-2 text-[11px] text-ink-faint">
        Seven frozen policies, evaluated by pure deterministic code. Model confidence has no
        input here. Risk derives only from these verdicts.
      </p>
      <ul>
        {findings.map((finding) => (
          <li key={finding.policyId} className="border-b border-edge px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusPill status={finding.status} />
              <code className="font-mono text-[12px] text-ink">{finding.policyId}</code>
              <span className="text-[13px] text-ink-dim">{finding.title}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">{finding.explanation}</p>
            {finding.affectedResources.length > 0 ? (
              <p className="mt-2 flex flex-wrap gap-1.5">
                {finding.affectedResources.map((resource) => (
                  <IdChip key={resource} value={resource} />
                ))}
              </p>
            ) : null}
            {finding.remediation ? (
              <p className="mt-2 text-[12px] text-ink-faint">
                <span className="eyebrow mr-1.5">Remediation</span>
                {finding.remediation}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
