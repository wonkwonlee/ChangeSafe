import { CORE_POLICY_VERSION, type ChangeOperation } from "@changesafe/core";

import { applyKubernetesOperations } from "./apply";
import { parseKubernetesPath } from "./paths";
import { evaluateMutableImage } from "./policies/mutable-image";
import { evaluatePrivilegeEscalation } from "./policies/privilege-escalation";
import { evaluateProtectedResource } from "./policies/protected-resource";
import { evaluateServiceSelector } from "./policies/service-selector";
import { evaluateWorkloadAvailability } from "./policies/workload-availability";
import type { KubernetesDomainAdapter } from "./schemas";

/** Bumped whenever Kubernetes policy behavior changes; recorded in receipts. */
export const KUBERNETES_POLICY_VERSION = "kubernetes-v0.1.0";
export const POLICY_VERSION = `${CORE_POLICY_VERSION}+${KUBERNETES_POLICY_VERSION}`;

/** Pure simulated-state adapter; it has no Kubernetes API, CLI, or AI dependency. */
export const kubernetesDomain: KubernetesDomainAdapter = {
  domainId: "kubernetes",
  policyVersion: POLICY_VERSION,

  stateOf(snapshot) {
    return {
      resources: Object.fromEntries(
        snapshot.resources.map((resource) => [resource.resourceId, structuredClone(resource)]),
      ),
    };
  },

  applyOperations(state, operations) {
    return applyKubernetesOperations(state, operations);
  },

  blastRadiusUnit(operation: ChangeOperation) {
    const parsed = parseKubernetesPath(operation.path);
    return parsed ? { kind: "kubernetes-resource", id: parsed.resourceId } : null;
  },

  untrustedTexts(snapshot) {
    return snapshot.resources.flatMap((resource) => [
      { evidenceId: resource.evidenceId, kind: "Kubernetes resource name", text: resource.identity.name },
      ...metadataTexts(resource.evidenceId, "annotation", resource.metadata.annotations),
      ...metadataTexts(resource.evidenceId, "label", resource.metadata.labels),
      ...("podLabels" in resource.spec && resource.spec.podLabels
        ? metadataTexts(resource.evidenceId, "pod label", resource.spec.podLabels)
        : []),
      ...("containers" in resource.spec && resource.spec.containers
        ? resource.spec.containers.flatMap((container) => [
            {
              evidenceId: resource.evidenceId,
              kind: "Kubernetes container name",
              text: container.name,
            },
            {
              evidenceId: resource.evidenceId,
              kind: "Kubernetes container image",
              text: container.image,
            },
          ])
        : []),
    ]);
  },

  knownEvidenceIds(snapshot) {
    return new Set([snapshot.evidenceId, ...snapshot.resources.map((resource) => resource.evidenceId)]);
  },

  policies: [
    { id: "K8S_PRIVILEGE_ESCALATION", evaluate: evaluatePrivilegeEscalation },
    { id: "K8S_WORKLOAD_AVAILABILITY", evaluate: evaluateWorkloadAvailability },
    { id: "K8S_SERVICE_SELECTOR", evaluate: evaluateServiceSelector },
    { id: "K8S_PROTECTED_RESOURCE", evaluate: evaluateProtectedResource },
    { id: "K8S_MUTABLE_IMAGE", evaluate: evaluateMutableImage },
  ],
};

function metadataTexts(
  evidenceId: string,
  kind: "annotation" | "label" | "pod label",
  values: Record<string, string>,
) {
  return Object.entries(values).flatMap(([key, value]) => [
    { evidenceId, kind: `Kubernetes ${kind} key`, text: key },
    { evidenceId, kind: `Kubernetes ${kind} value`, text: value },
  ]);
}
