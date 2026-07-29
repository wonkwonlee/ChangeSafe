import type { PolicyFinding } from "@changesafe/core";

import { isFinding, isService, isWorkload, labelsMatch, postChangeState, type KubernetesPolicyContext } from "./common";
import type { KubernetesState } from "../schemas";

function matchingWorkloads(state: KubernetesState, namespace: string, selector: Record<string, string>): string[] {
  return Object.values(state.resources)
    .filter((resource) => isWorkload(resource) && resource.identity.namespace === namespace)
    .filter((resource) => labelsMatch(selector, workloadLabels(resource)))
    .map((resource) => resource.resourceId)
    .sort();
}

function workloadLabels(resource: Parameters<typeof isWorkload>[0]): Record<string, string> {
  return "podLabels" in resource.spec ? resource.spec.podLabels ?? {} : {};
}

export function evaluateServiceSelector(context: KubernetesPolicyContext): PolicyFinding {
  const patched = postChangeState(context, "K8S_SERVICE_SELECTOR");
  if (isFinding(patched)) return patched;
  const before = context.adapter.stateOf(context.input);
  const failures: { path: string; name: string }[] = [];
  for (const service of Object.values(before.resources)) {
    if (!isService(service) || service.spec.type === "ExternalName" || !service.spec.selector || Object.keys(service.spec.selector).length === 0) continue;
    const beforeMatches = matchingWorkloads(before, service.identity.namespace, service.spec.selector);
    const afterService = patched.resources[service.resourceId];
    const afterSelector = afterService && isService(afterService) ? afterService.spec.selector : null;
    const afterMatches = afterSelector && Object.keys(afterSelector).length > 0
      ? matchingWorkloads(patched, service.identity.namespace, afterSelector)
      : [];
    if (beforeMatches.length > 0 && afterMatches.length === 0) failures.push({ path: `/resources/${service.resourceId}`, name: service.identity.name });
  }
  if (failures.length > 0) return {
    policyId: "K8S_SERVICE_SELECTOR", status: "BLOCK", title: "Service selectors lose every supported workload", explanation: failures.map(({ name }) => `Service "${name}" matched a supported workload before the change and none after it.`).join(" "), affectedResources: failures.map(({ path }) => path).sort(), remediation: "Preserve at least one matching workload label for every affected Service selector.",
  };
  return { policyId: "K8S_SERVICE_SELECTOR", status: "PASS", title: "Service selectors remain satisfiable", explanation: "Every selector-bearing, non-ExternalName Service that matched a supported workload before the change still has a match.", affectedResources: [], remediation: null };
}
