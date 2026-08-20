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

/** Build the AdmissionReview response envelope Kubernetes expects back. */
export function buildAdmissionReviewResponse(uid: string, result: AdmissionResult) {
  return {
    apiVersion: "admission.k8s.io/v1" as const,
    kind: "AdmissionReview" as const,
    response: result.allowed
      ? { uid, allowed: true as const }
      : { uid, allowed: false as const, status: { message: result.message } },
  };
}
