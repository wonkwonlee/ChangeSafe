import type { PolicyContext } from "../domain";
import { isDomainError } from "../errors";
import type { PolicyFinding } from "../findings";

/**
 * PATCH_SCHEMA: every operation must be a valid declarative mutation the
 * domain can actually apply. Unknown paths, missing targets, wrong value
 * shapes, and smuggled command strings are structural violations, not
 * judgment calls.
 */
export function evaluatePatchSchema<TInput, TState>(
  context: PolicyContext<TInput, TState>,
): PolicyFinding {
  const { adapter, input, proposal } = context;
  const violations: { path: string; message: string }[] = [];

  // Progressive single-operation application surfaces a per-operation
  // diagnostic while preserving sequential semantics (an operation may target
  // a prior operation's result).
  let working = adapter.stateOf(input);
  for (const operation of proposal.operations) {
    try {
      working = adapter.applyOperations(working, [operation]).nextState;
    } catch (error) {
      violations.push({
        path: operation.path,
        message: isDomainError(error) ? error.userMessage : "operation failed to apply",
      });
    }
  }

  if (violations.length > 0) {
    return {
      policyId: "PATCH_SCHEMA",
      status: "BLOCK",
      title: "Operations violate the declarative patch schema",
      explanation: violations
        .map((violation) => `${violation.path}: ${violation.message}`)
        .join(" | "),
      affectedResources: [...new Set(violations.map((violation) => violation.path))],
      remediation:
        "Restrict operations to allowlisted declarative paths with valid values and existing targets.",
    };
  }

  return {
    policyId: "PATCH_SCHEMA",
    status: "PASS",
    title: "All operations are valid declarative patches",
    explanation: `${proposal.operations.length} operation(s) target allowlisted state paths with valid values and resolvable targets. No command strings detected.`,
    affectedResources: proposal.operations.map((operation) => operation.path),
    remediation: null,
  };
}
