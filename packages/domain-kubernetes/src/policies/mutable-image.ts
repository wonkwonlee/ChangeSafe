import type { PolicyFinding } from "@changesafe/core";

import { existingAndProposed, isFinding, isWorkload, postChangeState, type KubernetesPolicyContext } from "./common";

function isMutableImage(image: string): boolean {
  if (image.includes("@sha256:")) return false;
  const finalSegment = image.slice(image.lastIndexOf("/") + 1);
  const colon = finalSegment.lastIndexOf(":");
  return colon < 0 || finalSegment.slice(colon + 1) === "latest";
}

export function evaluateMutableImage(context: KubernetesPolicyContext): PolicyFinding {
  const patched = postChangeState(context, "K8S_MUTABLE_IMAGE");
  if (isFinding(patched)) return patched;
  const violations = existingAndProposed(context, patched).flatMap(({ path, before, after }) => {
    if (!after || !isWorkload(after)) return [];
    const priorImages = new Set(before && isWorkload(before) ? (before.spec.containers ?? []).map((container) => container.image) : []);
    const mutable = (after.spec.containers ?? []).map((container) => container.image).filter((image) => !priorImages.has(image) && isMutableImage(image));
    return mutable.length > 0 ? [{ path, mutable }] : [];
  });
  if (violations.length > 0) return {
    policyId: "K8S_MUTABLE_IMAGE", status: "WARN", title: "Change introduces mutable container images", explanation: violations.map(({ path, mutable }) => `${path} introduces ${mutable.join(", ")}.`).join(" "), affectedResources: violations.map(({ path }) => path).sort(), remediation: "Use a digest-pinned image (preferred) or a non-latest immutable release tag.",
  };
  return { policyId: "K8S_MUTABLE_IMAGE", status: "PASS", title: "No mutable image is introduced", explanation: "Every newly introduced workload image is digest-pinned or carries a non-latest tag.", affectedResources: [], remediation: null };
}
