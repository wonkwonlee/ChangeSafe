import type { PolicyFinding, PolicyStatus, RiskLevel } from "@changesafe/core";

/**
 * Exit codes are the CLI's real interface in CI:
 *
 *   0  the gate evaluated the change and found nothing blocking
 *   1  the gate evaluated the change and blocked it
 *   2  the gate could not evaluate: bad usage, unreadable or invalid input
 *
 * The distinction between 1 and 2 matters. A 1 is a verdict; a 2 is a
 * missing verdict, and must never be read as approval.
 */
export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_USAGE = 2;

/** Collects output so commands stay pure and testable. */
export interface Console {
  out(line: string): void;
  err(line: string): void;
  readonly color: boolean;
}

export function createConsole(options: { color?: boolean } = {}): Console {
  const color =
    options.color ??
    (process.env.NO_COLOR === undefined && process.stdout.isTTY === true);
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    color,
  };
}

const CODES = {
  reset: "[0m",
  dim: "[2m",
  bold: "[1m",
  green: "[32m",
  yellow: "[33m",
  red: "[31m",
} as const;

export function paint(color: boolean, code: keyof typeof CODES, text: string): string {
  return color ? `${CODES[code]}${text}${CODES.reset}` : text;
}

const STATUS_COLOR: Record<PolicyStatus, keyof typeof CODES> = {
  PASS: "green",
  WARN: "yellow",
  BLOCK: "red",
};

const RISK_COLOR: Record<RiskLevel, keyof typeof CODES> = {
  LOW: "green",
  MEDIUM: "yellow",
  HIGH: "yellow",
  CRITICAL: "red",
};

/** Human-readable gate report. Blocking findings are explained in full. */
export function formatFindings(
  console: Console,
  findings: PolicyFinding[],
  riskLevel: RiskLevel,
): string[] {
  const lines: string[] = [];
  const width = Math.max(...findings.map((finding) => finding.policyId.length));

  for (const finding of findings) {
    const status = paint(console.color, STATUS_COLOR[finding.status], finding.status.padEnd(5));
    lines.push(`  ${status}  ${finding.policyId.padEnd(width)}  ${finding.title}`);
    if (finding.status !== "PASS") {
      lines.push(`         ${paint(console.color, "dim", finding.explanation)}`);
      for (const resource of finding.affectedResources) {
        lines.push(`         ${paint(console.color, "dim", `· ${resource}`)}`);
      }
      if (finding.remediation) {
        lines.push(`         ${paint(console.color, "dim", `→ ${finding.remediation}`)}`);
      }
    }
  }

  const counts = (["PASS", "WARN", "BLOCK"] as const).map((status) => {
    const count = findings.filter((finding) => finding.status === status).length;
    return paint(console.color, STATUS_COLOR[status], `${count} ${status}`);
  });

  lines.push("");
  lines.push(
    `  ${counts.join(paint(console.color, "dim", " · "))}   risk: ${paint(
      console.color,
      RISK_COLOR[riskLevel],
      paint(console.color, "bold", riskLevel),
    )}`,
  );
  return lines;
}
