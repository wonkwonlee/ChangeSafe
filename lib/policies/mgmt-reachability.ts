import { isDomainError } from "@/lib/domain/errors";
import type { PolicyFinding } from "@/lib/domain/schemas";
import { applyOperations } from "@/lib/patch/apply";
import { checkReachability } from "@/lib/patch/reachability";
import type { PolicyContext } from "./context";

/**
 * MGMT_REACHABILITY: simulate the patch on a clone and verify the declared
 * management origin still reaches every protected management target. Fails
 * closed: if the patch cannot even be applied, reachability cannot be proven
 * and the change is blocked.
 */
export function evaluateMgmtReachability(context: PolicyContext): PolicyFinding {
  const { bundle, proposal } = context;
  const management = bundle.currentState.management;

  let patchedState;
  try {
    patchedState = applyOperations(bundle.currentState, proposal.operations).nextState;
  } catch (error) {
    return {
      policyId: "MGMT_REACHABILITY",
      status: "BLOCK",
      title: "Management reachability cannot be proven",
      explanation: `The proposed operations fail to apply (${
        isDomainError(error) ? error.userMessage : "unexpected patch error"
      }), so post-change management reachability cannot be evaluated. Treated as blocking.`,
      affectedResources: management.protectedTargetNodeIds.map((id) => `node:${id}`),
      remediation: "Fix the operations so they apply cleanly, then re-validate.",
    };
  }

  const unreachable: { nodeId: string; reason: string }[] = [];
  for (const targetNodeId of management.protectedTargetNodeIds) {
    const result = checkReachability({
      topology: bundle.topology,
      state: patchedState,
      originNodeId: management.originNodeId,
      targetNodeId,
    });
    if (!result.reachable) {
      unreachable.push({ nodeId: targetNodeId, reason: result.reason });
    }
  }

  if (unreachable.length > 0) {
    return {
      policyId: "MGMT_REACHABILITY",
      status: "BLOCK",
      title: "Change severs management reachability",
      explanation:
        `After applying the proposal to a sandboxed copy, the management origin ` +
        `"${management.originNodeId}" can no longer reach: ` +
        unreachable.map((entry) => `${entry.nodeId} (${entry.reason})`).join("; ") +
        ". A change that cuts off management access can never be approved.",
      affectedResources: unreachable.map((entry) => `node:${entry.nodeId}`),
      remediation:
        "Preserve every management path (or add an equivalent route) before removing the implicated one.",
    };
  }

  return {
    policyId: "MGMT_REACHABILITY",
    status: "PASS",
    title: "Management reachability preserved",
    explanation:
      `Simulated on a sandboxed copy: management origin "${management.originNodeId}" ` +
      `still reaches all ${management.protectedTargetNodeIds.length} protected target(s) after the change.`,
    affectedResources: management.protectedTargetNodeIds.map((id) => `node:${id}`),
    remediation: null,
  };
}
