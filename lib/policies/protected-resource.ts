import type { PolicyFinding } from "@/lib/domain/schemas";
import { parsePatchPath } from "@/lib/patch/paths";
import type { PolicyContext } from "./context";

/**
 * PROTECTED_RESOURCE: block removal or disabling of any resource marked
 * `protected` in the canonical (pre-change) state. v0.1 supports no exception
 * mechanism — the bundled scenarios declare none.
 */
export function evaluateProtectedResource(context: PolicyContext): PolicyFinding {
  const { bundle, proposal } = context;
  const violations: { resource: string; detail: string }[] = [];

  for (const operation of proposal.operations) {
    const parsed = parsePatchPath(operation.path);
    if (!parsed) continue; // unparseable paths are PATCH_SCHEMA's finding

    const device = bundle.currentState.devices[parsed.deviceId];
    if (!device) continue;

    if (parsed.family === "route" && operation.op === "remove") {
      const route = device.routes[parsed.routeId];
      if (route?.protected) {
        violations.push({
          resource: `route:${parsed.deviceId}/${parsed.routeId}`,
          detail: `removes protected route "${parsed.routeId}" on "${parsed.deviceId}"`,
        });
      }
    }

    if (
      parsed.family === "interface-enabled" &&
      operation.op === "replace" &&
      operation.value === false &&
      device.protected
    ) {
      violations.push({
        resource: `interface:${parsed.deviceId}/${parsed.interfaceId}`,
        detail: `disables interface "${parsed.interfaceId}" on protected device "${parsed.deviceId}"`,
      });
    }
  }

  if (violations.length > 0) {
    return {
      policyId: "PROTECTED_RESOURCE",
      status: "BLOCK",
      title: "Change removes or disables a protected resource",
      explanation:
        violations.map((violation) => `Operation ${violation.detail}.`).join(" ") +
        " Protected resources cannot be removed or disabled in v0.1 (no exception mechanism exists).",
      affectedResources: violations.map((violation) => violation.resource),
      remediation:
        "Target a non-protected resource, or change the resource without removing or disabling it.",
    };
  }

  return {
    policyId: "PROTECTED_RESOURCE",
    status: "PASS",
    title: "No protected resource is removed or disabled",
    explanation:
      "Every operation leaves protected routes present and protected devices' interfaces enabled.",
    affectedResources: [],
    remediation: null,
  };
}
