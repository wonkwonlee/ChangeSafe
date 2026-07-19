import { DomainError } from "@/lib/domain/errors";
import type { ChangeOperation, CurrentState, RouteValue } from "@/lib/domain/schemas";
import { applyOperations } from "./apply";
import { parsePatchPath } from "./paths";

/**
 * Derive the exact inverse of a forward operation list using pre-change values
 * captured while applying against a clone. Result is in reverse order so
 * applying it after the forward list restores the original state.
 */
export function deriveInverseOperations(
  state: CurrentState,
  operations: ChangeOperation[],
): ChangeOperation[] {
  const inverses: ChangeOperation[] = [];
  let working = state;

  for (const operation of operations) {
    const { nextState, diff } = applyOperations(working, [operation]);
    const entry = diff[0];
    if (!entry) {
      throw new DomainError("INTERNAL", "patch application produced no diff entry");
    }

    const parsed = parsePatchPath(operation.path);
    if (!parsed) {
      throw new DomainError("PATCH_PATH_FORBIDDEN", `Path "${operation.path}" is not allowed`);
    }

    const reason = `Inverse of ${operation.op} on ${operation.path}`;
    const evidenceIds = operation.evidenceIds;

    switch (operation.op) {
      case "add":
        // The allowlist permits `remove` only for routes. An added routing
        // preference therefore has no expressible inverse; surfacing that
        // here keeps ROLLBACK_COMPLETE's fail-closed behavior honest.
        if (parsed.family !== "route") {
          throw new DomainError(
            "ROLLBACK_MISMATCH",
            `Adding ${parsed.family} "${operation.path}" has no allowlisted inverse operation`,
          );
        }
        inverses.push({ op: "remove", path: operation.path, value: null, reason, evidenceIds });
        break;
      case "replace":
        inverses.push({
          op: "replace",
          path: operation.path,
          value: entry.before as ChangeOperation["value"],
          reason,
          evidenceIds,
        });
        break;
      case "remove": {
        // entry.before captured the full route object, description as null if absent.
        const before = entry.before as Record<string, unknown>;
        const routeValue: RouteValue = {
          id: String(before.id),
          destination: String(before.destination),
          nextHop: String(before.nextHop) as RouteValue["nextHop"],
          metric: Number(before.metric),
          kind: String(before.kind) as RouteValue["kind"],
          protected: Boolean(before.protected),
          description:
            typeof before.description === "string" ? before.description : null,
        };
        inverses.push({ op: "add", path: operation.path, value: routeValue, reason, evidenceIds });
        break;
      }
    }

    working = nextState;
  }

  return inverses.reverse();
}
