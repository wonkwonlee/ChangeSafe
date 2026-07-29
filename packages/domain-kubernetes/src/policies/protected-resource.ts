import { canonicalize, type PolicyFinding } from "@changesafe/core";

import { existingAndProposed, isFinding, postChangeState, type KubernetesPolicyContext } from "./common";

export function evaluateProtectedResource(context: KubernetesPolicyContext): PolicyFinding {
  const patched = postChangeState(context, "K8S_PROTECTED_RESOURCE");
  if (isFinding(patched)) return patched;
  const violations = existingAndProposed(context, patched).filter(({ before, after }) =>
    before?.metadata.annotations["changesafe.dev/protected"] === "true" &&
    (!after || after.metadata.annotations["changesafe.dev/protected"] !== "true" || canonicalize(after.spec) !== canonicalize(before.spec)),
  );
  if (violations.length > 0) return {
    policyId: "K8S_PROTECTED_RESOURCE", status: "BLOCK", title: "Change alters a protected Kubernetes resource", explanation: violations.map(({ before }) => `Protected resource ${before!.identity.namespace}/${before!.identity.name} changes its normalized spec or protection annotation.`).join(" "), affectedResources: violations.map(({ path }) => path).sort(), remediation: "Do not alter protected resources; make the change through a separately reviewed protection-lift process.",
  };
  return { policyId: "K8S_PROTECTED_RESOURCE", status: "PASS", title: "Protected resources remain unchanged", explanation: "No existing resource annotated changesafe.dev/protected: true changes its normalized spec or loses protection.", affectedResources: [], remediation: null };
}
