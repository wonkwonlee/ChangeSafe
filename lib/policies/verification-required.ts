import type { PolicyFinding } from "@/lib/domain/schemas";
import type { PolicyContext } from "./context";

/**
 * VERIFICATION_REQUIRED: a change needs at least one precondition and one
 * post-change verification step. Incomplete verification warns (it does not
 * block), matching the frozen policy set.
 */
export function evaluateVerificationRequired(context: PolicyContext): PolicyFinding {
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
