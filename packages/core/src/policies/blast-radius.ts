import type { PolicyContext } from "../domain";
import type { PolicyFinding } from "../findings";

/**
 * BLAST_RADIUS: deterministic count of the units a change touches, where the
 * domain decides what a unit is (a device, a resource, a module).
 * One unit PASS, two WARN, more than two BLOCK. Zero assessable units fails
 * closed — nothing to bound means nothing can be bounded.
 */
export function evaluateBlastRadius<TInput, TState>(
  context: PolicyContext<TInput, TState>,
): PolicyFinding {
  const { adapter, proposal } = context;

  const units = new Map<string, string>();
  let unitKind: string | null = null;
  for (const operation of proposal.operations) {
    const unit = adapter.blastRadiusUnit(operation);
    if (!unit) continue;
    unitKind ??= unit.kind;
    units.set(`${unit.kind}:${unit.id}`, unit.id);
  }

  const resources = [...units.keys()].sort();
  const ids = [...units.values()].sort();
  const kind = unitKind ?? "resource";
  const plural = `${kind}s`;

  if (ids.length === 0) {
    return {
      policyId: "BLAST_RADIUS",
      status: "BLOCK",
      title: "Blast radius cannot be assessed",
      explanation: `No operation targets an allowlisted ${kind} path, so the change's blast radius cannot be bounded. Treated as blocking.`,
      affectedResources: [],
      remediation: `Use allowlisted declarative ${kind} paths so impact can be measured.`,
    };
  }

  if (ids.length === 1) {
    return {
      policyId: "BLAST_RADIUS",
      status: "PASS",
      title: `Blast radius limited to one ${kind}`,
      explanation: `All operations touch a single ${kind} (${ids[0]}).`,
      affectedResources: resources,
      remediation: null,
    };
  }

  if (ids.length === 2) {
    return {
      policyId: "BLAST_RADIUS",
      status: "WARN",
      title: `Blast radius spans two ${plural}`,
      explanation: `Operations modify two ${plural} (${ids.join(", ")}). Review whether a single-${kind} change would suffice.`,
      affectedResources: resources,
      remediation: `Consider splitting the change into single-${kind} steps.`,
    };
  }

  return {
    policyId: "BLAST_RADIUS",
    status: "BLOCK",
    title: "Blast radius too large",
    explanation: `Operations modify ${ids.length} ${plural} (${ids.join(", ")}), exceeding the two-${kind} limit for an emergency change.`,
    affectedResources: resources,
    remediation: `Reduce the change to at most two ${plural} per proposal.`,
  };
}
