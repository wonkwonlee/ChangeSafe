import type { PolicyFinding } from "@/lib/domain/schemas";
import { affectedDeviceIds } from "@/lib/patch/apply";
import type { PolicyContext } from "./context";

/**
 * BLAST_RADIUS: deterministic device count from forward operations.
 * 1 device PASS, 2 WARN, more than 2 BLOCK. Zero assessable devices fails
 * closed (nothing to bound means nothing can be bounded).
 */
export function evaluateBlastRadius(context: PolicyContext): PolicyFinding {
  const deviceIds = affectedDeviceIds(context.proposal.operations);
  const resources = deviceIds.map((id) => `device:${id}`);

  if (deviceIds.length === 0) {
    return {
      policyId: "BLAST_RADIUS",
      status: "BLOCK",
      title: "Blast radius cannot be assessed",
      explanation:
        "No operation targets an allowlisted device path, so the change's blast radius cannot be bounded. Treated as blocking.",
      affectedResources: [],
      remediation: "Use allowlisted declarative device paths so impact can be measured.",
    };
  }

  if (deviceIds.length === 1) {
    return {
      policyId: "BLAST_RADIUS",
      status: "PASS",
      title: "Blast radius limited to one device",
      explanation: `All operations touch a single device (${deviceIds[0]}).`,
      affectedResources: resources,
      remediation: null,
    };
  }

  if (deviceIds.length === 2) {
    return {
      policyId: "BLAST_RADIUS",
      status: "WARN",
      title: "Blast radius spans two devices",
      explanation: `Operations modify two devices (${deviceIds.join(", ")}). Review whether a single-device change would suffice.`,
      affectedResources: resources,
      remediation: "Consider splitting the change into single-device steps.",
    };
  }

  return {
    policyId: "BLAST_RADIUS",
    status: "BLOCK",
    title: "Blast radius too large",
    explanation: `Operations modify ${deviceIds.length} devices (${deviceIds.join(", ")}), exceeding the two-device limit for an emergency change.`,
    affectedResources: resources,
    remediation: "Reduce the change to at most two devices per proposal.",
  };
}
