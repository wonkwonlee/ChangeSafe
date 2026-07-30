/**
 * Parser-free entry point for already-decoded Kubernetes snapshot and manifest
 * data. App fixtures and other typed consumers use this boundary so importing
 * the package cannot pull the YAML text parser into their dependency graph.
 */
export {
  KubernetesChangeProposalSchema,
  KubernetesSnapshotSchema,
} from "./schemas";
export type { KubernetesChangeProposal, KubernetesSnapshot } from "./schemas";
export { normalizeSnapshot } from "./normalize";
export { deriveManifestProposal } from "./manifest-proposal";
export { kubernetesDomain } from "./adapter";
export { runKubernetesSimulation } from "./simulate";
export { KUBERNETES_POLICY_VERSION, POLICY_VERSION } from "./version";
