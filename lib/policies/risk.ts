import type { PolicyFinding, RiskLevel } from "@/lib/domain/schemas";

/**
 * Deterministic risk derivation — the only source of the approval risk level.
 * Model confidence is advisory display data and must never enter this
 * function.
 *
 *   any BLOCK            -> CRITICAL
 *   >= 2 WARN, no BLOCK  -> HIGH
 *   exactly 1 WARN       -> MEDIUM
 *   all PASS             -> LOW
 */
export function deriveRiskLevel(findings: PolicyFinding[]): RiskLevel {
  const blocks = findings.filter((finding) => finding.status === "BLOCK").length;
  if (blocks > 0) return "CRITICAL";

  const warns = findings.filter((finding) => finding.status === "WARN").length;
  if (warns >= 2) return "HIGH";
  if (warns === 1) return "MEDIUM";
  return "LOW";
}
