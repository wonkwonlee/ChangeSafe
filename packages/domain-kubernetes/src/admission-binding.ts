import { canonicalize, sha256Hex } from "@changesafe/core";
import { canonicalizeAdmittedResource } from "./normalize";

export const GRANT_ANNOTATION = "changesafe.dev/grant";

/** Full admission state, excluding only server bookkeeping and its own carrier. */
export async function kubernetesObjectSha256(raw: unknown): Promise<string> {
  const object = canonicalizeAdmittedResource(raw, "ev-admission-review");
  const annotations = { ...(object.metadata.annotations as Record<string, string> | undefined) };
  delete annotations[GRANT_ANNOTATION];
  return sha256Hex(canonicalize({
    identity: object.identity,
    metadata: { ...object.metadata, annotations },
    spec: object.spec,
  }));
}
