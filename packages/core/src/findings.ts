import { z } from "zod";

/**
 * Policy verdicts and the deterministic risk derivation.
 *
 * Policy ids are open: core owns the universal ones below, and each domain
 * contributes its own. The gate's ordering and risk formula never depend on
 * which ids exist.
 */

export const POLICY_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const PolicyIdSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(POLICY_ID_PATTERN, "policy ids are UPPER_SNAKE_CASE");

/** Policies core provides for every domain. */
export const UNIVERSAL_POLICY_IDS = [
  "PATCH_SCHEMA",
  "BLAST_RADIUS",
  "ROLLBACK_COMPLETE",
  "VERIFICATION_REQUIRED",
  "UNTRUSTED_INSTRUCTION",
] as const;

/**
 * Universal policies a domain may declare inapplicable.
 *
 * Deliberately a strict subset of `UNIVERSAL_POLICY_IDS`: `PATCH_SCHEMA`,
 * `BLAST_RADIUS`, and `UNTRUSTED_INSTRUCTION` are structurally answerable by
 * every domain (a null `blastRadiusUnit` already fails closed; every domain
 * must implement `untrustedTexts`), so there is no legitimate reason to skip
 * them and no domain gets to declare one. Only the two policies whose shape
 * assumes an inverse patch or a model-authored proposal — neither of which
 * an external-diff domain has — may ever be replaced.
 */
export const SKIPPABLE_UNIVERSAL_POLICY_IDS = [
  "ROLLBACK_COMPLETE",
  "VERIFICATION_REQUIRED",
] as const satisfies readonly (typeof UNIVERSAL_POLICY_IDS)[number][];

export type SkippableUniversalPolicyId = (typeof SKIPPABLE_UNIVERSAL_POLICY_IDS)[number];

export const PolicyStatusSchema = z.enum(["PASS", "WARN", "BLOCK"]);

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const PolicyFindingSchema = z.strictObject({
  policyId: PolicyIdSchema,
  status: PolicyStatusSchema,
  title: z.string().min(1).max(160),
  explanation: z.string().min(1).max(2000),
  /** Stable resource references, e.g. "device:edge-rtr-01" or a state path. */
  affectedResources: z.array(z.string().min(1).max(256)).max(32),
  remediation: z.string().max(1000).nullable(),
});

export type PolicyId = z.infer<typeof PolicyIdSchema>;
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type PolicyFinding = z.infer<typeof PolicyFindingSchema>;

/**
 * The only source of the approval risk level. Model confidence is advisory
 * display data and must never reach this function.
 *
 *   any BLOCK            -> CRITICAL
 *   >= 2 WARN, no BLOCK  -> HIGH
 *   exactly 1 WARN       -> MEDIUM
 *   all PASS             -> LOW
 */
export function deriveRiskLevel(findings: Pick<PolicyFinding, "status">[]): RiskLevel {
  const blocks = findings.filter((finding) => finding.status === "BLOCK").length;
  if (blocks > 0) return "CRITICAL";

  const warns = findings.filter((finding) => finding.status === "WARN").length;
  if (warns >= 2) return "HIGH";
  if (warns === 1) return "MEDIUM";
  return "LOW";
}

/** True when any finding blocks — the single predicate the workflow trusts. */
export function hasBlockingFinding(findings: Pick<PolicyFinding, "status">[]): boolean {
  return findings.some((finding) => finding.status === "BLOCK");
}
