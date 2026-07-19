import type { ChangeProposal, IncidentBundle, PolicyFinding, PolicyId, RiskLevel } from "@/lib/domain/schemas";
import { evaluateBlastRadius } from "./blast-radius";
import type { PolicyContext } from "./context";
import { evaluateMgmtReachability } from "./mgmt-reachability";
import { evaluatePatchSchema } from "./patch-schema";
import { evaluateProtectedResource } from "./protected-resource";
import { deriveRiskLevel } from "./risk";
import { evaluateRollbackComplete } from "./rollback-complete";
import { evaluateUntrustedInstruction } from "./untrusted-instruction";
import { evaluateVerificationRequired } from "./verification-required";

export type { PolicyContext } from "./context";
export { deriveRiskLevel } from "./risk";

/** Frozen evaluation order — stable for findings display and receipts. */
export const POLICY_ORDER: readonly PolicyId[] = [
  "PATCH_SCHEMA",
  "MGMT_REACHABILITY",
  "PROTECTED_RESOURCE",
  "BLAST_RADIUS",
  "ROLLBACK_COMPLETE",
  "VERIFICATION_REQUIRED",
  "UNTRUSTED_INSTRUCTION",
];

export interface PolicyEvaluation {
  findings: PolicyFinding[];
  riskLevel: RiskLevel;
}

/**
 * The deterministic safety gate. Pure: same bundle + proposal always produce
 * the same findings and risk. Every policy evaluates independently and fails
 * closed on its own; none of them consult the model or each other.
 */
export function evaluatePolicies(
  bundle: IncidentBundle,
  proposal: ChangeProposal,
): PolicyEvaluation {
  const context: PolicyContext = { bundle, proposal };

  const findings: PolicyFinding[] = [
    evaluatePatchSchema(context),
    evaluateMgmtReachability(context),
    evaluateProtectedResource(context),
    evaluateBlastRadius(context),
    evaluateRollbackComplete(context),
    evaluateVerificationRequired(context),
    evaluateUntrustedInstruction(context),
  ];

  return { findings, riskLevel: deriveRiskLevel(findings) };
}
