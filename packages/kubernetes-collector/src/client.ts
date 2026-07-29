import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { ReadOnlyKubernetesClient } from "./types";

const runtimeRequire = createRequire(import.meta.url);

function loadKubernetesClient(): typeof import("@kubernetes/client-node") {
  return runtimeRequire("@kubernetes/client-node");
}

interface CredentialUser { exec?: unknown; authProvider?: unknown; "auth-provider"?: unknown }

export function rejectCredentialPlugins(config: { users?: ReadonlyArray<CredentialUser> }): void {
  for (const entry of config.users ?? []) {
    if (entry.exec !== undefined || entry.authProvider !== undefined || entry["auth-provider"] !== undefined) {
      throw new Error("kubeconfig exec and auth-provider credentials are not supported");
    }
  }
}

/** Narrow adapter: only namespaced get/list methods are exposed to collection. */
export function createReadOnlyClient(kubeconfigPath?: string, context?: string): ReadOnlyKubernetesClient {
  const { k8s, config } = loadConfiguration(kubeconfigPath, context);
  return clientFromConfiguration(k8s, config);
}

function clientFromConfiguration(
  k8s: typeof import("@kubernetes/client-node"),
  config: import("@kubernetes/client-node").KubeConfig,
): ReadOnlyKubernetesClient {
  const apps = config.makeApiClient(k8s.AppsV1Api);
  const core = config.makeApiClient(k8s.CoreV1Api);
  return {
    async serverVersion() { const version = await config.makeApiClient(k8s.VersionApi).getCode(); return version.gitVersion ?? "unknown"; },
    async listDeployments(namespace) { return (await apps.listNamespacedDeployment({ namespace })).items; },
    async listStatefulSets(namespace) { return (await apps.listNamespacedStatefulSet({ namespace })).items; },
    async listDaemonSets(namespace) { return (await apps.listNamespacedDaemonSet({ namespace })).items; },
    async listServices(namespace) { return (await core.listNamespacedService({ namespace })).items; },
  };
}

export function contextFingerprint(kubeconfigPath?: string, context?: string): string {
  return loadConfiguration(kubeconfigPath, context).fingerprint;
}

export function createReadOnlyClientWithFingerprint(
  kubeconfigPath?: string,
  context?: string,
): { client: ReadOnlyKubernetesClient; fingerprint: string } {
  const loaded = loadConfiguration(kubeconfigPath, context);
  return {
    client: clientFromConfiguration(loaded.k8s, loaded.config),
    fingerprint: loaded.fingerprint,
  };
}

function loadConfiguration(kubeconfigPath?: string, context?: string): {
  k8s: typeof import("@kubernetes/client-node");
  config: import("@kubernetes/client-node").KubeConfig;
  fingerprint: string;
} {
  const k8s = loadKubernetesClient();
  const config = new k8s.KubeConfig();
  if (kubeconfigPath) config.loadFromFile(kubeconfigPath); else config.loadFromDefault();
  const selected = context ?? config.getCurrentContext();
  if (context) config.setCurrentContext(context);
  const entry = config.getContexts().find((candidate) => candidate.name === selected);
  const user = config.getUsers().find((candidate) => candidate.name === entry?.user);
  rejectCredentialPlugins({ users: user ? [user] : [] });
  const cluster = config.getClusters().find((candidate) => candidate.name === entry?.cluster);
  if (!cluster?.server) throw new Error("kubeconfig context has no API server");
  return {
    k8s,
    config,
    fingerprint: createHash("sha256").update(`${new URL(cluster.server).origin}\u0000${selected}`).digest("hex"),
  };
}
