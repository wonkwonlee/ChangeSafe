import { z } from "zod";

/**
 * Wire contracts for application API routes. These are importable from client
 * code (no server dependencies) so both sides validate the same shapes.
 */

/**
 * The app's own status contract.
 *
 * It deliberately advertises no provider, model, or live-analysis capability:
 * `/api/reviews/analyze` serves validated bundled replay only, so reporting a
 * configured provider here would describe a capability this application does
 * not offer. Live analysis is a CLI and self-hosted-server concern.
 */
export const StatusResponseSchema = z.strictObject({
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
