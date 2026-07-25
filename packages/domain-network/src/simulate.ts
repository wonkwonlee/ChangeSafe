import {
  SimulationResultSchema,
  type ChangeProposal,
  type SimulationResult,
} from "@changesafe/core";
import type { CurrentState, IncidentBundle, SafetyProperty } from "./schemas";
import { applyOperations } from "./apply";
import { parsePatchPath } from "./paths";
import { checkReachability } from "./reachability";

/**
 * Sandboxed simulation: applies the (already policy-validated) forward
 * operations to a deep clone via the transactional patch engine and
 * re-evaluates every declared safety property against the result. The
 * bundle's canonical state is never mutated.
 */
export function runSimulation(
  bundle: IncidentBundle,
  proposal: ChangeProposal,
): SimulationResult {
  const { nextState, diff } = applyOperations(bundle.currentState, proposal.operations);

  const changed = new Set<string>();
  for (const operation of proposal.operations) {
    const parsed = parsePatchPath(operation.path);
    if (parsed) changed.add(`device:${parsed.deviceId}`);
    changed.add(operation.path);
  }

  const safetyProperties = bundle.expectedSafetyProperties.map((property) =>
    evaluateSafetyProperty(bundle, nextState, property),
  );

  const satisfiedCount = safetyProperties.filter((p) => p.satisfied).length;
  const summary =
    `${diff.length} operation${diff.length === 1 ? "" : "s"} applied to a sandboxed copy; ` +
    `${satisfiedCount} of ${safetyProperties.length} declared safety properties remain satisfied. ` +
    `No real infrastructure was contacted.`;

  return SimulationResultSchema.parse({
    status: "completed",
    changedResourceIds: [...changed].sort(),
    diff,
    safetyProperties,
    summary,
  });
}

function evaluateSafetyProperty(
  bundle: IncidentBundle,
  patched: CurrentState,
  property: SafetyProperty,
): { propertyId: string; satisfied: boolean; detail: string } {
  const check = property.check;

  switch (check.type) {
    case "mgmt-reachability": {
      const unreachable: string[] = [];
      for (const target of patched.management.protectedTargetNodeIds) {
        const result = checkReachability({
          topology: bundle.topology,
          state: patched,
          originNodeId: patched.management.originNodeId,
          targetNodeId: target,
        });
        if (!result.reachable) unreachable.push(target);
      }
      return unreachable.length === 0
        ? {
            propertyId: property.id,
            satisfied: true,
            detail: "Management origin still reaches every protected target.",
          }
        : {
            propertyId: property.id,
            satisfied: false,
            detail: `Management origin can no longer reach: ${unreachable.join(", ")}.`,
          };
    }

    case "route-exists": {
      const exists = Boolean(patched.devices[check.nodeId]?.routes[check.routeId]);
      return {
        propertyId: property.id,
        satisfied: exists,
        detail: exists
          ? `Route "${check.routeId}" on "${check.nodeId}" is still present.`
          : `Route "${check.routeId}" on "${check.nodeId}" is missing after the change.`,
      };
    }

    case "interface-enabled": {
      const enabled = Boolean(
        patched.devices[check.nodeId]?.interfaces[check.interfaceId]?.enabled,
      );
      return {
        propertyId: property.id,
        satisfied: enabled,
        detail: enabled
          ? `Interface "${check.interfaceId}" on "${check.nodeId}" remains enabled.`
          : `Interface "${check.interfaceId}" on "${check.nodeId}" is disabled after the change.`,
      };
    }

    case "protected-resources-intact": {
      const violations: string[] = [];
      for (const [deviceId, device] of Object.entries(bundle.currentState.devices)) {
        for (const [routeId, route] of Object.entries(device.routes)) {
          if (route.protected && !patched.devices[deviceId]?.routes[routeId]) {
            violations.push(`route ${deviceId}/${routeId} removed`);
          }
        }
        if (device.protected) {
          for (const [interfaceId, iface] of Object.entries(device.interfaces)) {
            if (iface.enabled && patched.devices[deviceId]?.interfaces[interfaceId]?.enabled === false) {
              violations.push(`interface ${deviceId}/${interfaceId} disabled`);
            }
          }
        }
      }
      return violations.length === 0
        ? {
            propertyId: property.id,
            satisfied: true,
            detail: "All protected resources remain present and enabled.",
          }
        : {
            propertyId: property.id,
            satisfied: false,
            detail: `Protected resources affected: ${violations.join("; ")}.`,
          };
    }
  }
}
