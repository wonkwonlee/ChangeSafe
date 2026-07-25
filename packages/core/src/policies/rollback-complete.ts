import { canonicallyEqual } from "../canonical";
import type { DomainAdapter, PolicyContext } from "../domain";
import { isDomainError } from "../errors";
import type { PolicyFinding } from "../findings";
import type { ChangeOperation } from "../proposal";

export type RollbackVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Prove a rollback restores the canonical pre-change state: apply forward
 * operations, then rollback operations, both against clones, and compare
 * canonically with the original. Any application failure is a failed
 * verdict, never an exception — callers turn this into a finding.
 */
export function verifyRollback<TInput, TState>(
  adapter: DomainAdapter<TInput, TState>,
  state: TState,
  forwardOperations: ChangeOperation[],
  rollbackOperations: ChangeOperation[],
): RollbackVerdict {
  if (rollbackOperations.length === 0) {
    return { ok: false, reason: "no rollback operations were provided" };
  }

  let afterForward: TState;
  try {
    afterForward = adapter.applyOperations(state, forwardOperations).nextState;
  } catch (error) {
    return {
      ok: false,
      reason: `forward operations failed to apply: ${
        isDomainError(error) ? error.userMessage : "unexpected error"
      }`,
    };
  }

  let afterRollback: TState;
  try {
    afterRollback = adapter.applyOperations(afterForward, rollbackOperations).nextState;
  } catch (error) {
    return {
      ok: false,
      reason: `rollback operations failed to apply: ${
        isDomainError(error) ? error.userMessage : "unexpected error"
      }`,
    };
  }

  if (!canonicallyEqual(afterRollback, state)) {
    return {
      ok: false,
      reason: "applying rollback after the change does not restore the original state",
    };
  }

  return { ok: true };
}

/**
 * ROLLBACK_COMPLETE: the provided rollback must actually restore the
 * canonical pre-change state when replayed on a sandboxed copy. Absent or
 * broken rollback blocks; fails closed when the forward patch cannot apply.
 */
export function evaluateRollbackComplete<TInput, TState>(
  context: PolicyContext<TInput, TState>,
): PolicyFinding {
  const { adapter, input, proposal } = context;
  const verdict = verifyRollback(
    adapter,
    adapter.stateOf(input),
    proposal.operations,
    proposal.rollbackOperations,
  );

  if (!verdict.ok) {
    return {
      policyId: "ROLLBACK_COMPLETE",
      status: "BLOCK",
      title: "Rollback does not restore the original state",
      explanation: `Rollback verification failed: ${verdict.reason}. An emergency change without a proven rollback cannot be approved.`,
      affectedResources: proposal.rollbackOperations.map((operation) => operation.path),
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
    affectedResources: proposal.rollbackOperations.map((operation) => operation.path),
    remediation: null,
  };
}
