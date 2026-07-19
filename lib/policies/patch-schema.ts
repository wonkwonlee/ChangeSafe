import { isDomainError } from "@/lib/domain/errors";
import type { CurrentState, PolicyFinding } from "@/lib/domain/schemas";
import { applyOperations } from "@/lib/patch/apply";
import { looksExecutable } from "@/lib/patch/paths";
import type { PolicyContext } from "./context";

/**
 * PATCH_SCHEMA: every operation must be an allowlisted declarative mutation
 * with a valid value and an existing (or validly absent) target. Command
 * strings and unknown paths are structural violations, not judgment calls.
 */
export function evaluatePatchSchema(context: PolicyContext): PolicyFinding {
  const violations: { path: string; message: string }[] = [];

  // Progressive single-op application surfaces a per-operation diagnostic
  // while preserving sequential semantics (an op may target a prior op's result).
  let working: CurrentState = context.bundle.currentState;
  for (const operation of context.proposal.operations) {
    try {
      working = applyOperations(working, [operation]).nextState;
    } catch (error) {
      violations.push({
        path: operation.path,
        message: isDomainError(error) ? error.userMessage : "operation failed to apply",
      });
      continue;
    }

    // The engine validates structured values; descriptions are free text and
    // additionally screened for executable content here.
    if (
      operation.value !== null &&
      typeof operation.value === "object" &&
      typeof operation.value.description === "string" &&
      looksExecutable(operation.value.description)
    ) {
      violations.push({
        path: operation.path,
        message: "route description contains executable content",
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
    explanation: `${context.proposal.operations.length} operation(s) target allowlisted state paths with valid values and resolvable targets. No command strings detected.`,
    affectedResources: context.proposal.operations.map((operation) => operation.path),
    remediation: null,
  };
}
