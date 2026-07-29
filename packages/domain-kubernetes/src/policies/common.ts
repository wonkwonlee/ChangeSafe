import {
  DomainError,
  isDomainError,
  type PolicyContext,
  type PolicyFinding,
} from "@changesafe/core";

import { parseKubernetesPath } from "../paths";
import type {
  KubernetesDaemonSetResource,
  KubernetesDeploymentResource,
  KubernetesResource,
  KubernetesServiceResource,
  KubernetesSnapshot,
  KubernetesStatefulSetResource,
  KubernetesState,
} from "../schemas";

export type KubernetesWorkloadResource =
  | KubernetesDeploymentResource
  | KubernetesStatefulSetResource
  | KubernetesDaemonSetResource;
export type KubernetesScalableWorkloadResource = KubernetesDeploymentResource | KubernetesStatefulSetResource;

export type KubernetesPolicyContext = PolicyContext<KubernetesSnapshot, KubernetesState>;

function operationPaths(operations: unknown): string[] {
  if (!Array.isArray(operations)) return [];
  const paths = new Set<string>();
  for (const operation of operations) {
    if (
      typeof operation !== "object" ||
      operation === null ||
      !("path" in operation) ||
      typeof operation.path !== "string" ||
      !parseKubernetesPath(operation.path)
    ) {
      continue;
    }
    paths.add(operation.path);
    if (paths.size === 32) break;
  }
  return [...paths].sort();
}

/** Every domain policy needs the same authoritative post-change state. */
export function postChangeState(
  context: KubernetesPolicyContext,
  policyId: string,
): KubernetesState | PolicyFinding {
  const operations = context.proposal.operations;
  const forwardRemoval = Array.isArray(operations)
    ? operations.find(
        (operation) =>
          typeof operation === "object" &&
          operation !== null &&
          "op" in operation &&
          operation.op === "remove" &&
          "path" in operation &&
          typeof operation.path === "string",
      )
    : undefined;
  if (forwardRemoval) {
    return {
      policyId,
      status: "BLOCK",
      title: "Kubernetes resource deletion is unsupported",
      explanation: `${policyId} cannot evaluate a forward remove operation. Manifest omission is not deletion, and v0.3.0 accepts only add or replace operations.`,
      affectedResources: [forwardRemoval.path],
      remediation: "Remove the delete intent and submit only complete resource upserts.",
    };
  }
  try {
    return context.adapter.applyOperations(
      context.adapter.stateOf(context.input),
      context.proposal.operations,
    ).nextState;
  } catch (error) {
    const detail = isDomainError(error)
      ? error.userMessage
      : "unexpected patch error";
    return {
      policyId,
      status: "BLOCK",
      title: "Post-change Kubernetes state cannot be proven",
      explanation: `${policyId} cannot evaluate the proposed state because the operations fail to apply (${detail}). An unevaluated safety policy is blocking.`,
      affectedResources: operationPaths(context.proposal.operations),
      remediation: "Fix the malformed operation and re-run the deterministic gate.",
    };
  }
}

export function isFinding(value: KubernetesState | PolicyFinding): value is PolicyFinding {
  return "policyId" in value;
}

export function isWorkload(resource: KubernetesResource): resource is KubernetesWorkloadResource {
  return resource.identity.kind !== "Service";
}

export function isService(resource: KubernetesResource): resource is KubernetesServiceResource {
  return resource.identity.kind === "Service";
}

export function isDeployment(resource: KubernetesResource): resource is KubernetesDeploymentResource {
  return resource.identity.kind === "Deployment";
}

export function isStatefulSet(resource: KubernetesResource): resource is KubernetesStatefulSetResource {
  return resource.identity.kind === "StatefulSet";
}

export function isScalableWorkload(
  resource: KubernetesResource,
): resource is KubernetesScalableWorkloadResource {
  return resource.identity.kind === "Deployment" || resource.identity.kind === "StatefulSet";
}

export function existingAndProposed(
  context: KubernetesPolicyContext,
  patched: KubernetesState,
): { path: string; before: KubernetesResource | undefined; after: KubernetesResource | undefined }[] {
  return context.proposal.operations.map((operation) => {
    const parsed = parseKubernetesPath(operation.path);
    if (!parsed) {
      throw new DomainError("PATCH_PATH_FORBIDDEN", `Path "${operation.path}" is invalid.`);
    }
    return {
      path: operation.path,
      before: context.adapter.stateOf(context.input).resources[parsed.resourceId],
      after: patched.resources[parsed.resourceId],
    };
  });
}

export function labelsMatch(selector: Record<string, string>, labels: Record<string, string>): boolean {
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}
