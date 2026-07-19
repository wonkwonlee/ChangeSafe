import type { PolicyFinding } from "@/lib/domain/schemas";
import { verifyRollback } from "@/lib/patch/rollback-verify";
import type { PolicyContext } from "./context";

/**
 * ROLLBACK_COMPLETE: the provided rollback must actually restore the
 * canonical pre-change state when tested on a sandboxed copy (forward ops,
 * then rollback ops, then canonical equality). Absent or broken rollback
 * blocks; fails closed when the forward patch itself cannot apply.
 */
export function evaluateRollbackComplete(context: PolicyContext): PolicyFinding {
  const verdict = verifyRollback(
    context.bundle.currentState,
    context.proposal.operations,
    context.proposal.rollbackOperations,
  );

  if (!verdict.ok) {
    return {
      policyId: "ROLLBACK_COMPLETE",
      status: "BLOCK",
      title: "Rollback does not restore the original state",
      explanation: `Rollback verification failed: ${verdict.reason}. An emergency change without a proven rollback cannot be approved.`,
      affectedResources: context.proposal.rollbackOperations.map((operation) => operation.path),
      remediation:
        "Provide an inverse operation for every forward operation, in reverse-safe order, restoring captured pre-change values.",
    };
  }

  return {
    policyId: "ROLLBACK_COMPLETE",
    status: "PASS",
    title: "Rollback verified against a sandboxed copy",
    explanation:
      "Applying the forward operations and then the rollback operations restores a canonically identical pre-change state.",
    affectedResources: context.proposal.rollbackOperations.map((operation) => operation.path),
    remediation: null,
  };
}
