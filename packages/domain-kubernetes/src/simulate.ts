import {
  SimulationResultSchema,
  canonicalize,
  type ChangeProposal,
  type SimulationResult,
} from "@changesafe/core";

import { applyKubernetesOperations } from "./apply";
import { kubernetesDomain } from "./adapter";
import { parseKubernetesPath } from "./paths";
import {
  KubernetesChangeProposalSchema,
  KubernetesSnapshotSchema,
  type KubernetesResource,
  type KubernetesServiceResource,
  type KubernetesSnapshot,
  type KubernetesState,
} from "./schemas";

const BASELINE_CAPABILITIES = new Set([
  "AUDIT_WRITE", "CHOWN", "DAC_OVERRIDE", "FOWNER", "FSETID", "KILL", "MKNOD",
  "NET_BIND_SERVICE", "SETFCAP", "SETGID", "SETPCAP", "SETUID", "SYS_CHROOT",
]);

/**
 * Evaluate the modeled Kubernetes invariants after applying a proposal to an
 * in-memory clone. This has no Kubernetes API, filesystem, clock, or apply path.
 */
export function runKubernetesSimulation(
  snapshot: KubernetesSnapshot,
  proposal: ChangeProposal,
): SimulationResult {
  const validatedSnapshot = KubernetesSnapshotSchema.parse(snapshot);
  const validatedProposal = KubernetesChangeProposalSchema.parse(proposal);
  const before = kubernetesDomain.stateOf(validatedSnapshot);
  const { nextState, diff } = applyKubernetesOperations(before, validatedProposal.operations);
  const changedResourceIds = [...new Set(validatedProposal.operations.map((operation) => {
    const parsed = parseKubernetesPath(operation.path);
    if (!parsed) throw new Error(`unparseable Kubernetes operation path ${operation.path}`);
    return parsed.resourceId;
  }))].sort();
  const safetyProperties = [
    zeroReplicaProperty(nextState, changedResourceIds),
    serviceSelectorProperty(before, nextState),
    privilegeProperty(before, nextState, changedResourceIds),
    protectedResourceProperty(before, nextState),
  ];
  const satisfiedCount = safetyProperties.filter((property) => property.satisfied).length;
  const summary =
    `${diff.length} Kubernetes resource operation${diff.length === 1 ? "" : "s"} applied to a sandboxed copy; ` +
    `${satisfiedCount} of ${safetyProperties.length} modeled safety properties remain satisfied. ` +
    "No Kubernetes API was contacted and no manifest was applied.";
  return SimulationResultSchema.parse({
    status: "completed",
    changedResourceIds,
    diff,
    safetyProperties,
    summary,
  });
}

function isWorkload(resource: KubernetesResource): boolean {
  return resource.identity.kind !== "Service";
}

function isService(resource: KubernetesResource): resource is KubernetesServiceResource {
  return resource.identity.kind === "Service";
}

function isScalable(resource: KubernetesResource): boolean {
  return resource.identity.kind === "Deployment" || resource.identity.kind === "StatefulSet";
}

function zeroReplicaProperty(state: KubernetesState, changedResourceIds: string[]) {
  const zero = changedResourceIds
    .map((id) => state.resources[id])
    .filter((resource): resource is KubernetesResource => Boolean(resource))
    .filter(isScalable)
    .filter((resource) => "replicas" in resource.spec && (resource.spec.replicas ?? 1) === 0)
    .map((resource) => `${resource.identity.namespace}/${resource.identity.name}`)
    .sort();
  return zero.length === 0
    ? { propertyId: "k8s-no-zero-replica-workloads", satisfied: true, detail: "No affected Deployment or StatefulSet has zero replicas." }
    : { propertyId: "k8s-no-zero-replica-workloads", satisfied: false, detail: `Affected workload(s) have zero replicas: ${zero.join(", ")}.` };
}

function serviceSelectorProperty(before: KubernetesState, after: KubernetesState) {
  const orphaned = new Set<string>();
  for (const resource of Object.values(before.resources)) {
    if (!isService(resource) || resource.spec.type === "ExternalName" || !resource.spec.selector || Object.keys(resource.spec.selector).length === 0) continue;
    const beforeMatches = matchingWorkloads(before, resource.identity.namespace, resource.spec.selector);
    const afterService = after.resources[resource.resourceId];
    const afterSelector = afterService && isService(afterService) ? afterService.spec.selector : null;
    const afterMatches = afterSelector && Object.keys(afterSelector).length > 0 ? matchingWorkloads(after, resource.identity.namespace, afterSelector) : [];
    if (beforeMatches.length > 0 && afterMatches.length === 0) {
      orphaned.add(`${resource.identity.namespace}/${resource.identity.name}`);
    }
  }
  for (const resource of Object.values(after.resources)) {
    if (before.resources[resource.resourceId] || !isService(resource) || resource.spec.type === "ExternalName" || !resource.spec.selector || Object.keys(resource.spec.selector).length === 0) continue;
    if (matchingWorkloads(after, resource.identity.namespace, resource.spec.selector).length === 0) {
      orphaned.add(`${resource.identity.namespace}/${resource.identity.name}`);
    }
  }
  const names = [...orphaned].sort();
  return names.length === 0
    ? { propertyId: "k8s-service-selectors-resolve", satisfied: true, detail: "Every previously satisfied modeled Service selector and every new selector-bearing Service resolves to a supported workload." }
    : { propertyId: "k8s-service-selectors-resolve", satisfied: false, detail: `Service selector(s) do not resolve: ${names.join(", ")}.` };
}

function matchingWorkloads(state: KubernetesState, namespace: string, selector: Record<string, string>): string[] {
  return Object.values(state.resources)
    .filter(isWorkload)
    .filter((resource) => resource.identity.namespace === namespace)
    .filter((resource) => Object.entries(selector).every(([key, value]) => workloadLabels(resource)[key] === value))
    .map((resource) => resource.resourceId)
    .sort();
}

function workloadLabels(resource: KubernetesResource): Record<string, string> {
  return "podLabels" in resource.spec ? resource.spec.podLabels ?? {} : {};
}

function privilegeProperty(before: KubernetesState, after: KubernetesState, changedResourceIds: string[]) {
  const violations = changedResourceIds.flatMap((id) => {
    const current = after.resources[id];
    if (!current || !isWorkload(current)) return [];
    const previous = before.resources[id];
    const oldSignals = previous && isWorkload(previous) ? privilegeSignals(previous) : new Set<string>();
    const introduced = [...privilegeSignals(current)].filter((signal) => !oldSignals.has(signal));
    return introduced.length === 0 ? [] : [`${current.identity.namespace}/${current.identity.name}`];
  }).sort();
  return violations.length === 0
    ? { propertyId: "k8s-no-new-privileged-workloads", satisfied: true, detail: "No affected workload newly enables a modeled privileged setting." }
    : { propertyId: "k8s-no-new-privileged-workloads", satisfied: false, detail: `Affected workload(s) newly enable privileged settings: ${violations.join(", ")}.` };
}

function privilegeSignals(resource: KubernetesResource): Set<string> {
  const signals = new Set<string>();
  if (!("containers" in resource.spec)) return signals;
  for (const field of ["hostNetwork", "hostPID", "hostIPC", "hasHostPath"] as const) {
    if (resource.spec[field]) signals.add(field);
  }
  for (const container of resource.spec.containers ?? []) {
    const security = container.security;
    if (!security) continue;
    if (security.privileged) signals.add(`${container.name}:privileged`);
    if (security.allowPrivilegeEscalation) signals.add(`${container.name}:allowPrivilegeEscalation`);
    if (security.runAsUser === 0) signals.add(`${container.name}:runAsUser=0`);
    for (const capability of security.addedCapabilities ?? []) if (!BASELINE_CAPABILITIES.has(capability)) signals.add(`${container.name}:${capability}`);
  }
  return signals;
}

function protectedResourceProperty(before: KubernetesState, after: KubernetesState) {
  const violations = Object.values(before.resources)
    .filter((resource) => resource.metadata.annotations["changesafe.dev/protected"] === "true")
    .filter((resource) => {
      const current = after.resources[resource.resourceId];
      return !current || current.metadata.annotations["changesafe.dev/protected"] !== "true" || canonicalize(current.spec) !== canonicalize(resource.spec);
    })
    .map((resource) => `${resource.identity.namespace}/${resource.identity.name}`)
    .sort();
  return violations.length === 0
    ? { propertyId: "k8s-protected-resources-unchanged", satisfied: true, detail: "Every protected resource retains its normalized spec and protection annotation." }
    : { propertyId: "k8s-protected-resources-unchanged", satisfied: false, detail: `Protected resource(s) changed: ${violations.join(", ")}.` };
}
