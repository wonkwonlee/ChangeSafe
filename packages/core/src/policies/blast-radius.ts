import type { PolicyContext } from "../domain";
import type { PolicyFinding } from "../findings";

/**
 * BLAST_RADIUS: deterministic count of the units a change touches, where the
 * domain decides what a unit is (a device, a resource, a module) and the
 * policy pack decides the thresholds (default: warn at 2, block above 2).
 * Zero assessable units fails closed — nothing to bound means nothing can be
 * bounded.
 */
export function evaluateBlastRadius<TInput, TState>(
  context: PolicyContext<TInput, TState>,
): PolicyFinding {
  const { adapter, proposal, pack } = context;
  const { warnAt, blockAbove } = pack.blastRadius;

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

  if (ids.length > blockAbove) {
    return {
      policyId: "BLAST_RADIUS",
      status: "BLOCK",
      title: "Blast radius too large",
      explanation: `Operations modify ${ids.length} ${plural} (${ids.join(", ")}), exceeding the limit of ${blockAbove} ${blockAbove === 1 ? kind : plural} for an emergency change.`,
      affectedResources: resources,
      remediation: `Reduce the change to at most ${blockAbove} ${blockAbove === 1 ? kind : plural} per proposal.`,
    };
  }

  if (ids.length >= warnAt) {
    return {
      policyId: "BLAST_RADIUS",
      status: "WARN",
      title: `Blast radius spans ${ids.length} ${plural}`,
      explanation: `Operations modify ${ids.length} ${plural} (${ids.join(", ")}). Review whether a narrower change would suffice.`,
      affectedResources: resources,
      remediation: `Consider splitting the change into single-${kind} steps.`,
    };
  }

  return {
    policyId: "BLAST_RADIUS",
    status: "PASS",
    title:
      ids.length === 1
        ? `Blast radius limited to one ${kind}`
        : `Blast radius within limits (${ids.length} ${plural})`,
    explanation:
      ids.length === 1
        ? `All operations touch a single ${kind} (${ids[0]}).`
        : `Operations touch ${ids.length} ${plural} (${ids.join(", ")}), within the warning threshold of ${warnAt}.`,
    affectedResources: resources,
    remediation: null,
  };
}
