import type { PolicyContext } from "../domain";
import type { PolicyFinding } from "../findings";

/**
 * VERIFICATION_REQUIRED: a change needs at least one precondition and one
 * post-change verification step. Incomplete verification warns rather than
 * blocks — a reviewer can still choose to accept it knowingly.
 */
export function evaluateVerificationRequired<TInput, TState>(
  context: PolicyContext<TInput, TState>,
): PolicyFinding {
  const steps = context.proposal.verificationSteps;
  const preconditions = steps.filter((step) => step.kind === "precondition").length;
  const postchecks = steps.filter((step) => step.kind === "postcheck").length;

  if (preconditions >= 1 && postchecks >= 1) {
    return {
      policyId: "VERIFICATION_REQUIRED",
      status: "PASS",
      title: "Verification plan is complete",
      explanation: `The proposal declares ${preconditions} precondition(s) and ${postchecks} post-change check(s).`,
      affectedResources: [],
      remediation: null,
    };
  }

  const missing = [
    ...(preconditions === 0 ? ["a precondition check"] : []),
    ...(postchecks === 0 ? ["a post-change verification step"] : []),
  ];

  return {
    policyId: "VERIFICATION_REQUIRED",
    status: "WARN",
    title: "Verification plan is incomplete",
    explanation: `The proposal is missing ${missing.join(" and ")}. A reviewer should not approve without knowing how success will be verified.`,
    affectedResources: [],
    remediation: "Add the missing verification step(s) to the proposal.",
  };
}
