import type { PolicyStatus, RiskLevel } from "@changesafe/core";

/** Verdict pill — the only place PASS/WARN/BLOCK colors are defined for text. */
export function StatusPill({ status }: { status: PolicyStatus }) {
  const styles: Record<PolicyStatus, string> = {
    PASS: "text-pass border-pass/40 bg-pass/10",
    WARN: "text-warn border-warn/40 bg-warn/10",
    BLOCK: "text-block border-block/40 bg-block/10",
  };
  return (
    <span
      className={`eyebrow inline-flex min-w-14 items-center justify-center rounded border px-2 py-0.5 ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const styles: Record<RiskLevel, string> = {
    LOW: "text-pass border-pass/50",
    MEDIUM: "text-warn border-warn/50",
    HIGH: "text-warn border-warn bg-warn/15",
    CRITICAL: "text-block border-block bg-block/15",
  };
  return (
    <span className={`eyebrow inline-flex items-center rounded border px-2.5 py-1 ${styles[level]}`}>
      risk: {level}
    </span>
  );
}

/** Monospace identifier chip (evidence ids, resource refs, paths, hashes). */
export function IdChip({ value }: { value: string }) {
  return (
    <code className="break-all rounded border border-edge bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
      {value}
    </code>
  );
}

export function SeverityDot({ severity }: { severity: "info" | "warning" | "critical" }) {
  const color =
    severity === "critical" ? "bg-block" : severity === "warning" ? "bg-warn" : "bg-ink-faint";
  return <span aria-hidden className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

export type StageTone = "idle" | "active" | "pass" | "warn" | "block" | "ai";

/**
 * Airlock rail stage header. The numbered node takes the stage's current
 * state color, making workflow position readable at a glance.
 */
export function StageHeader({
  number,
  title,
  authority,
  tone,
}: {
  number: number;
  title: string;
  /** Who owns this stage — rendered as the section's provenance tag. */
  authority: string;
  tone: StageTone;
}) {
  const nodeStyles: Record<StageTone, string> = {
    idle: "border-edge text-ink-faint",
    active: "border-active text-active",
    pass: "border-pass text-pass",
    warn: "border-warn text-warn",
    block: "border-block text-block",
    ai: "border-ai text-ai",
  };
  const authorityStyles = authority.includes("AI")
    ? "text-ai border-ai/40"
    : authority.includes("DETERMINISTIC")
      ? "text-ink border-edge-strong"
      : "text-active border-active/40";
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-canvas font-mono text-xs font-bold ${nodeStyles[tone]}`}
      >
        {number}
      </span>
      <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
      <span className={`eyebrow rounded border px-2 py-0.5 ${authorityStyles}`}>{authority}</span>
    </div>
  );
}

/** Stage body container hanging off the rail. */
export function StageCard({
  children,
  last = false,
}: {
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`relative ml-3.5 min-w-0 border-l-2 border-edge pb-8 pl-4 pt-3 sm:pl-6 ${last ? "border-transparent" : ""}`}
    >
      {children}
    </div>
  );
}
