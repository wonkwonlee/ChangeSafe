import { z } from "zod";

/**
 * The subset of Kubernetes admission.k8s.io/v1 AdmissionReview this
 * verifier needs. `object` is intentionally `z.unknown()` here — it is
 * validated and normalized by @changesafe/domain-kubernetes's own
 * normalization pipeline (Task 8), not re-specified here.
 */
export const AdmissionUserInfoSchema = z.looseObject({
  username: z.string().min(1),
  uid: z.string().optional(),
  groups: z.array(z.string()).optional(),
});

export const AdmissionOperationSchema = z.enum(["CREATE", "UPDATE", "DELETE", "CONNECT"]);

export const AdmissionRequestSchema = z.looseObject({
  uid: z.string().min(1),
  operation: AdmissionOperationSchema,
  userInfo: AdmissionUserInfoSchema,
  object: z.unknown(),
  dryRun: z.boolean().optional(),
  /**
   * The object's state before this request, present on UPDATE (and DELETE,
   * which this verifier doesn't handle yet — see webhook YAML comments).
   * Absent on CREATE, since there is no prior state.
   */
  oldObject: z.unknown().optional(),
});

export const AdmissionReviewRequestSchema = z.looseObject({
  apiVersion: z.literal("admission.k8s.io/v1"),
  kind: z.literal("AdmissionReview"),
  request: AdmissionRequestSchema,
});

export type AdmissionUserInfo = z.infer<typeof AdmissionUserInfoSchema>;
export type AdmissionRequest = z.infer<typeof AdmissionRequestSchema>;
export type AdmissionReviewRequest = z.infer<typeof AdmissionReviewRequestSchema>;

export type AdmissionResult =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * What the enforcer asks the API server to record about its own answer, in
 * the audit event for this request (`AdmissionResponse.auditAnnotations`;
 * the API server prefixes each key with the webhook's name). The enforcer
 * cannot see whether the write is later persisted: only the API server's
 * own audit event carries that outcome, and these keys let that event name
 * the grant this answer concerned (docs/M4_EXPERIMENT_02.md, P1).
 * Recording is not attestation: audit can be disabled, sampled or lost,
 * and an absent annotation means "unknown", never "did not happen".
 */
export type GrantAuditAnnotations = {
  "grant-id": string;
  /** `request.uid`, the same id the use-state records (P2). */
  "admission-uid": string;
  /**
   * The enforcer's answer only. `allow-consumed` burned the grant;
   * `allow-dry-run` did not; `deny` covers every refusal. A later stage
   * may still reject an allowed request, which the audit event's own
   * response status shows.
   */
  outcome: "allow-consumed" | "allow-dry-run" | "deny";
};

/** Build the AdmissionReview response envelope Kubernetes expects back. */
export function buildAdmissionReviewResponse(
  uid: string,
  result: AdmissionResult,
  auditAnnotations?: GrantAuditAnnotations,
) {
  const audit = auditAnnotations === undefined ? {} : { auditAnnotations };
  return {
    apiVersion: "admission.k8s.io/v1" as const,
    kind: "AdmissionReview" as const,
    response: result.allowed
      ? { uid, allowed: true as const, ...audit }
      : { uid, allowed: false as const, status: { message: result.message }, ...audit },
  };
}
