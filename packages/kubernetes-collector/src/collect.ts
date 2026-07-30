import { createHash } from "node:crypto";
import { normalizeSnapshot, type KubernetesSnapshot } from "@changesafe/domain-kubernetes";
import type { CollectOptions, ReadOnlyKubernetesClient } from "./types";

const LISTERS = [
  "listDeployments",
  "listStatefulSets",
  "listDaemonSets",
  "listServices",
] as const;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Collect a complete, namespace-scoped snapshot using only injected get/list methods. */
export async function collectKubernetesSnapshot(
  options: CollectOptions,
  client: ReadOnlyKubernetesClient,
): Promise<KubernetesSnapshot> {
  const namespaces = [...new Set(options.namespaces)].sort();
  if (namespaces.length === 0) throw new Error("at least one namespace is required");
  if (!Number.isInteger(options.maxResources) || options.maxResources < 1) {
    throw new Error("maxResources must be a positive integer");
  }
  const collected: unknown[] = [];
  const limit = (): void => {
    if (collected.length > options.maxResources) throw new Error("Kubernetes snapshot exceeds the resource limit");
  };

  // Sequential calls make the cap and failure boundary easy to reason about.
  for (const namespace of namespaces) {
    for (const method of LISTERS) {
      const resources = await client[method](namespace);
      if (!Array.isArray(resources)) throw new Error(`Kubernetes ${method} returned an invalid response`);
      collected.push(...resources);
      limit();
    }
  }

  const now = options.now();
  const seed = `${options.contextFingerprint}\u0000${namespaces.join("\u0000")}\u0000${now}`;
  return normalizeSnapshot({
    snapshotVersion: "changesafe-kubernetes-snapshot/v1",
    snapshotId: `snapshot-kubernetes-${digest(seed)}`,
    evidenceId: "ev-kubernetes-snapshot",
    provenance: {
      source: "cluster-api",
      collectedAtUtc: now,
      contextFingerprint: options.contextFingerprint,
      namespaces,
      serverVersion: await client.serverVersion(),
    },
    resources: collected,
  });
}
