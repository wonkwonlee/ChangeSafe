import { z } from "zod";

/**
 * Wire contracts for application API routes. These are importable from client
 * code (no server dependencies) so both sides validate the same shapes.
 */

export const StatusResponseSchema = z.strictObject({
  liveAvailable: z.boolean(),
  /** Configured provider and model, or null when live mode is unconfigured.
   *  Never a credential, and never a promise that a call will succeed. */
  provider: z.string().max(32).nullable(),
  model: z.string().max(64).nullable(),
  appVersion: z.string().max(32),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export {
  REVIEW_ANALYZE_API_VERSION,
  ReviewAnalyzeDomainIdV1Schema,
  ReviewAnalyzeErrorV1Schema,
  ReviewAnalyzeRequestV1Schema,
  ReviewAnalyzeSuccessV1Schema,
} from "../../features/domains/review-api-contract";
export type {
  ReviewAnalyzeDomainIdV1,
  ReviewAnalyzeErrorV1,
  ReviewAnalyzeRequestV1,
  ReviewAnalyzeSuccessV1,
} from "../../features/domains/review-api-contract";
