import type { DomainAdapter, PolicyContext } from "../domain";
import { deriveRiskLevel, type PolicyFinding, type RiskLevel } from "../findings";
import type { ChangeProposal } from "../proposal";
import { evaluateBlastRadius } from "./blast-radius";
import { evaluatePatchSchema } from "./patch-schema";
import { evaluateRollbackComplete } from "./rollback-complete";
import { evaluateUntrustedInstruction } from "./untrusted-instruction";
import { evaluateVerificationRequired } from "./verification-required";

export { evaluateBlastRadius } from "./blast-radius";
export { evaluatePatchSchema } from "./patch-schema";
export { evaluateRollbackComplete, verifyRollback } from "./rollback-complete";
export type { RollbackVerdict } from "./rollback-complete";
export { evaluateUntrustedInstruction } from "./untrusted-instruction";
export { evaluateVerificationRequired } from "./verification-required";

export interface PolicyEvaluation {
  findings: PolicyFinding[];
  riskLevel: RiskLevel;
}

/**
 * The deterministic safety gate.
 *
 * Order is fixed and meaningful: is the change well-formed at all
 * (PATCH_SCHEMA), then the domain's own safety checks, then the universal
 * questions of scope, reversibility, verification, and input trust. Pure —
 * the same input and proposal always produce the same findings and risk, and
 * no policy may consult a model or read model confidence.
 */
export function evaluatePolicies<TInput, TState>(
  adapter: DomainAdapter<TInput, TState>,
  input: TInput,
  proposal: ChangeProposal,
): PolicyEvaluation {
  const context: PolicyContext<TInput, TState> = { input, proposal, adapter };

  const domainFindings = adapter.policies.map((policy) => {
    const finding = policy.evaluate(context);
    if (finding.policyId !== policy.id) {
      // A domain whose declared id and produced id disagree would silently
      // break scenario expectations and receipt comparison.
      throw new Error(
        `domain "${adapter.domainId}" declared policy "${policy.id}" but produced "${finding.policyId}"`,
      );
    }
    return finding;
  });

  const findings: PolicyFinding[] = [
    evaluatePatchSchema(context),
    ...domainFindings,
    evaluateBlastRadius(context),
    evaluateRollbackComplete(context),
    evaluateVerificationRequired(context),
    evaluateUntrustedInstruction(context),
  ];

  return { findings, riskLevel: deriveRiskLevel(findings) };
}

/** The policy ids the gate produces for a domain, in evaluation order. */
export function policyOrder<TInput, TState>(
  adapter: DomainAdapter<TInput, TState>,
): string[] {
  return [
    "PATCH_SCHEMA",
    ...adapter.policies.map((policy) => policy.id),
    "BLAST_RADIUS",
    "ROLLBACK_COMPLETE",
    "VERIFICATION_REQUIRED",
    "UNTRUSTED_INSTRUCTION",
  ];
}
