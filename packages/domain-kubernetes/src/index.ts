/**
 * @changesafe/domain-kubernetes — pure contracts for offline Kubernetes
 * snapshots and proposed manifest changes. This package never contacts or
 * mutates a Kubernetes cluster.
 */

export {
  KubernetesChangeOperationSchema,
  KubernetesChangeProposalSchema,
  KubernetesIdentitySchema,
  KubernetesKindSchema,
  KubernetesManifestSetSchema,
  KubernetesMetadataSchema,
  KubernetesNamespaceSchema,
  KubernetesResourceNameSchema,
  KubernetesReplayFixtureSchema,
  KubernetesResourceIdSchema,
  KubernetesResourceSchema,
  KubernetesSnapshotProvenanceSchema,
  KubernetesSnapshotSchema,
  KubernetesStateSchema,
} from "./schemas";
export type {
  DerivedKubernetesProposal,
  KubernetesChangeOperation,
  KubernetesChangeProposal,
  KubernetesDomainAdapter,
  KubernetesIdentity,
  KubernetesKind,
  KubernetesManifestSet,
  KubernetesMetadata,
  KubernetesDeploymentResource,
  KubernetesStatefulSetResource,
  KubernetesDaemonSetResource,
  KubernetesServiceResource,
  KubernetesReplayFixture,
  KubernetesResource,
  KubernetesSnapshot,
  KubernetesSnapshotProvenance,
  KubernetesState,
} from "./schemas";

export { resourceIdOf } from "./identity";
export { normalizeSnapshot } from "./normalize";
export { normalizeRawResource } from "./normalize";
export { deriveManifestProposal } from "./manifest-proposal";
export { parseManifestDocuments } from "./manifests";
export { parseKubernetesPath } from "./paths";
export { applyKubernetesOperations } from "./apply";
export type { KubernetesPatchResult } from "./apply";
export { kubernetesDomain, KUBERNETES_POLICY_VERSION, POLICY_VERSION } from "./adapter";
export { evaluatePrivilegeEscalation } from "./policies/privilege-escalation";
export { evaluateWorkloadAvailability } from "./policies/workload-availability";
export { evaluateServiceSelector } from "./policies/service-selector";
export { evaluateProtectedResource } from "./policies/protected-resource";
export { evaluateMutableImage } from "./policies/mutable-image";
export { runKubernetesSimulation } from "./simulate";
