import { isDomainError } from "@/lib/domain/errors";
import type { ChangeOperation, CurrentState } from "@/lib/domain/schemas";
import { canonicallyEqual } from "@/lib/receipt/canonical";
import { applyOperations } from "./apply";

export type RollbackVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Prove a rollback restores the canonical pre-change state: apply forward
 * operations, then rollback operations, both against clones, and compare
 * canonically with the original. Any application failure is a failed verdict,
 * never an exception — callers turn this into a deterministic finding.
 */
export function verifyRollback(
  state: CurrentState,
  forwardOperations: ChangeOperation[],
  rollbackOperations: ChangeOperation[],
): RollbackVerdict {
  if (rollbackOperations.length === 0) {
    return { ok: false, reason: "no rollback operations were provided" };
  }

  let afterForward: CurrentState;
  try {
    afterForward = applyOperations(state, forwardOperations).nextState;
  } catch (error) {
    return {
      ok: false,
      reason: `forward operations failed to apply: ${
        isDomainError(error) ? error.userMessage : "unexpected error"
      }`,
    };
  }

  let afterRollback: CurrentState;
  try {
    afterRollback = applyOperations(afterForward, rollbackOperations).nextState;
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
