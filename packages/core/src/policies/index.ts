import type { DomainAdapter, PolicyContext } from "../domain";
import { isDomainError } from "../errors";
import { deriveRiskLevel, type PolicyFinding, type RiskLevel } from "../findings";
import type { ChangeProposal } from "../proposal";
import { resolvePolicyPack, type PolicyPack } from "../policy-pack";
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

export interface EvaluateOptions {
  /** Typed threshold overrides; omitted means ChangeSafe's defaults. */
  policyPack?: PolicyPack | null;
}

/**
 * Run one policy such that it fails closed even when it fails *unexpectedly*.
 *
 * "All policies fail closed" has to hold for a policy with a bug in it, not
 * only for a policy that reaches a considered verdict. An escaping throw
 * would otherwise abandon the whole evaluation: no findings, no risk, no
 * receipt — a change that was never judged, which is the one outcome the gate
 * must never produce quietly. A policy that cannot answer is therefore
 * recorded as BLOCK under its own id, which makes the change unapprovable and
 * puts the failure on the receipt where someone will see it.
 *
 * The message carries no internals: typed domain errors are written for
 * people, and anything else is reported only as having happened.
 */
function evaluateFailClosed(policyId: string, evaluate: () => PolicyFinding): PolicyFinding {
  try {
    return evaluate();
  } catch (error) {
    const detail = isDomainError(error) ? error.userMessage : "an unexpected internal error";
    return {
      policyId,
      status: "BLOCK",
      title: "Policy could not be evaluated",
      explanation: `${policyId} did not reach a verdict (${detail}). An unevaluated policy is treated as blocking: the gate cannot show this change is safe.`,
      affectedResources: [],
      remediation:
        "Report this with the input and proposal that triggered it. Until the policy evaluates, this change cannot be approved through ChangeSafe.",
    };
  }
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
  options: EvaluateOptions = {},
): PolicyEvaluation {
  const context: PolicyContext<TInput, TState> = {
    input,
    proposal,
    adapter,
    // Core defaults, then the domain's sane baseline, then the user's pack.
    pack: resolvePolicyPack(adapter.defaultPolicyPack, options.policyPack),
  };

  const skipped = new Set(
    (adapter.skippedUniversalPolicies ?? []).map((skip) => skip.policyId),
  );

  const domainFindings = adapter.policies.map((policy) => {
    const finding = evaluateFailClosed(policy.id, () => policy.evaluate(context));
    if (finding.policyId !== policy.id) {
      // A domain whose declared id and produced id disagree would silently
      // break scenario expectations and receipt comparison.
      throw new Error(
        `domain "${adapter.domainId}" declared policy "${policy.id}" but produced "${finding.policyId}"`,
      );
    }
    return finding;
  });

  const universal: [string, () => PolicyFinding][] = [
    ["PATCH_SCHEMA", () => evaluatePatchSchema(context)],
    ["BLAST_RADIUS", () => evaluateBlastRadius(context)],
    ["ROLLBACK_COMPLETE", () => evaluateRollbackComplete(context)],
    ["VERIFICATION_REQUIRED", () => evaluateVerificationRequired(context)],
    ["UNTRUSTED_INSTRUCTION", () => evaluateUntrustedInstruction(context)],
  ];
  const run = (id: string): PolicyFinding[] => {
    if (skipped.has(id)) return [];
    const entry = universal.find(([candidate]) => candidate === id);
    return entry ? [evaluateFailClosed(id, entry[1])] : [];
  };

  const findings: PolicyFinding[] = [
    ...run("PATCH_SCHEMA"),
    ...domainFindings,
    ...run("BLAST_RADIUS"),
    ...run("ROLLBACK_COMPLETE"),
    ...run("VERIFICATION_REQUIRED"),
    ...run("UNTRUSTED_INSTRUCTION"),
  ];

  return { findings, riskLevel: deriveRiskLevel(findings) };
}

/** The policy ids the gate produces for a domain, in evaluation order. */
export function policyOrder<TInput, TState>(
  adapter: DomainAdapter<TInput, TState>,
): string[] {
  const skipped = new Set(
    (adapter.skippedUniversalPolicies ?? []).map((skip) => skip.policyId),
  );
  return [
    "PATCH_SCHEMA",
    ...adapter.policies.map((policy) => policy.id),
    "BLAST_RADIUS",
    "ROLLBACK_COMPLETE",
    "VERIFICATION_REQUIRED",
    "UNTRUSTED_INSTRUCTION",
  ].filter((policyId) => !skipped.has(policyId));
}
