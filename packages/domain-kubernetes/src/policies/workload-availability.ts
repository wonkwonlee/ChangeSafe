import type { PolicyFinding } from "@changesafe/core";

import {
  existingAndProposed,
  isDeployment,
  isFinding,
  isScalableWorkload,
  postChangeState,
  type KubernetesPolicyContext,
} from "./common";

function replicas(resource: { spec: { replicas?: number } }): number { return resource.spec.replicas ?? 1; }

function effectiveMaxUnavailable(
  value: number | string | undefined,
  replicaCount: number,
): number {
  const configured = value ?? "25%";
  const unavailable = typeof configured === "number"
    ? configured
    // Deployment maxUnavailable percentages are rounded down by Kubernetes.
    : Math.floor(replicaCount * Number.parseInt(configured, 10) / 100);
  return Math.min(unavailable, replicaCount);
}

function maxUnavailableIncreases(
  before: number | string | undefined,
  beforeReplicas: number,
  after: number | string | undefined,
  afterReplicas: number,
): boolean {
  return (
    effectiveMaxUnavailable(after, afterReplicas) >
    effectiveMaxUnavailable(before, beforeReplicas)
  );
}

export function evaluateWorkloadAvailability(context: KubernetesPolicyContext): PolicyFinding {
  const patched = postChangeState(context, "K8S_WORKLOAD_AVAILABILITY");
  if (isFinding(patched)) return patched;
  const blocked: { path: string; detail: string }[] = [];
  const warned: { path: string; detail: string }[] = [];
  for (const { path, before, after } of existingAndProposed(context, patched)) {
    if (!before || !after || !isScalableWorkload(before)) continue;
    if (!isScalableWorkload(after)) {
      blocked.push({ path, detail: "changes a supported workload into a different resource kind" });
      continue;
    }
    const oldReplicas = replicas(before);
    const newReplicas = replicas(after);
    if (oldReplicas > 0 && newReplicas === 0) blocked.push({ path, detail: "reduces an existing workload to zero replicas" });
    else if (newReplicas < oldReplicas) warned.push({ path, detail: `reduces replicas from ${oldReplicas} to ${newReplicas}` });
    if (isDeployment(before) && isDeployment(after)) {
      const beforeRollingUpdate = (before.spec.strategy ?? "RollingUpdate") === "RollingUpdate";
      const afterRollingUpdate = (after.spec.strategy ?? "RollingUpdate") === "RollingUpdate";
      if (beforeRollingUpdate && !afterRollingUpdate) blocked.push({ path, detail: "changes RollingUpdate strategy to Recreate" });
      else if (beforeRollingUpdate && afterRollingUpdate && maxUnavailableIncreases(
        before.spec.maxUnavailable,
        oldReplicas,
        after.spec.maxUnavailable,
        newReplicas,
      )) warned.push({ path, detail: "increases maxUnavailable" });
    }
  }
  if (blocked.length > 0) return {
    policyId: "K8S_WORKLOAD_AVAILABILITY", status: "BLOCK", title: "Change breaks modeled workload availability",
    explanation: blocked.map(({ path, detail }) => `${path} ${detail}.`).join(" "), affectedResources: [...new Set(blocked.map(({ path }) => path))].sort(),
    remediation: "Keep at least one replica and preserve RollingUpdate strategy for existing workloads.",
  };
  if (warned.length > 0) return {
    policyId: "K8S_WORKLOAD_AVAILABILITY", status: "WARN", title: "Change reduces modeled workload availability",
    explanation: warned.map(({ path, detail }) => `${path} ${detail}.`).join(" "), affectedResources: [...new Set(warned.map(({ path }) => path))].sort(),
    remediation: "Confirm the reduced capacity and disruption budget are safe for the planned window.",
  };
  return { policyId: "K8S_WORKLOAD_AVAILABILITY", status: "PASS", title: "Modeled workload availability is preserved", explanation: "No existing Deployment or StatefulSet is reduced to zero, changed to Recreate, or given a wider modeled disruption budget.", affectedResources: [], remediation: null };
}
