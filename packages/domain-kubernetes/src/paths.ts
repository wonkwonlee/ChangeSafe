import { KubernetesResourceIdSchema } from "./schemas";

/** Resource-level paths are the only declarative patch surface in v0.3.0. */
export function parseKubernetesPath(path: string): { resourceId: string } | null {
  const match = /^\/resources\/(res-[a-f0-9]{16})$/.exec(path);
  if (!match) return null;
  const resourceId = match[1]!;
  return KubernetesResourceIdSchema.safeParse(resourceId).success ? { resourceId } : null;
}
