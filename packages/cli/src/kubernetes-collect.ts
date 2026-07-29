import { open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { collectKubernetesSnapshot, createReadOnlyClientWithFingerprint, type ReadOnlyKubernetesClient } from "@changesafe/kubernetes-collector";
import { UsageError } from "./io";
import { EXIT_OK, type Console } from "./output";

export interface KubernetesCollectOptions {
  namespaces?: string[];
  kubeconfig?: string;
  context?: string;
  out?: string;
  /** Test seam; production always constructs the narrow read-only client. */
  client?: ReadOnlyKubernetesClient;
  now?: () => string;
}

export async function runKubernetesCollect(options: KubernetesCollectOptions, console: Console): Promise<number> {
  const namespaces = [...new Set(options.namespaces ?? [])].filter(Boolean).sort();
  if (namespaces.length === 0) throw new UsageError("kubernetes collect requires at least one --namespace");
  if (!options.out) throw new UsageError("kubernetes collect requires --out <snapshot.json>");
  try {
    const loaded = options.client
      ? { client: options.client, fingerprint: "injected-client" }
      : createReadOnlyClientWithFingerprint(options.kubeconfig, options.context);
    const snapshot = await collectKubernetesSnapshot(
      {
        namespaces,
        contextFingerprint: loaded.fingerprint,
        now: options.now ?? (() => new Date().toISOString()),
        maxResources: 2000,
      },
      loaded.client,
    );
    await writeSnapshotAtomically(options.out, snapshot);
    console.out(JSON.stringify({ snapshotId: snapshot.snapshotId, namespaces, resources: snapshot.resources.length, out: path.resolve(options.out) }, null, 2));
    return EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`Kubernetes collection failed (${classifyCollectionFailure(error)}).`);
  }
}

function classifyCollectionFailure(error: unknown): "authentication" | "authorization" | "timeout" | "request" {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/403|forbidden|authorization|permission/.test(message)) return "authorization";
  if (/401|unauthori|authentication|token/.test(message)) return "authentication";
  if (/timeout|timed out|deadline|econnreset/.test(message)) return "timeout";
  return "request";
}

async function writeSnapshotAtomically(filePath: string, value: unknown): Promise<void> {
  const absolute = path.resolve(filePath);
  const temporary = `${absolute}.${process.pid}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new UsageError(error instanceof Error ? `Kubernetes collection failed: ${error.message}` : "Kubernetes collection failed");
  }
}
