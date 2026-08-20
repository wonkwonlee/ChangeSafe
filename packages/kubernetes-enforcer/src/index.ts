/**
 * @changesafe/kubernetes-enforcer — verifies AuthorizationGrant at a
 * Kubernetes admission-webhook boundary. Never calls the Kubernetes API;
 * only receives AdmissionReview webhook requests and answers allow/deny.
 */
export { createEnforcerServer } from "./server";
export type { EnforcerServerOptions } from "./server";
export { verifyGrantAgainstAdmission } from "./verify";
export type { VerifyOptions, VerifyOutcome } from "./verify";
export {
  AdmissionReviewRequestSchema,
  buildAdmissionReviewResponse,
} from "./admission-review";
export type { AdmissionRequest, AdmissionReviewRequest, AdmissionResult } from "./admission-review";
