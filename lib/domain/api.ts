import { z } from "zod";
import {
  AnalysisModeSchema,
  FixtureProvenanceSchema,
  IdSchema,
} from "@changesafe/core";
import { NetworkChangeProposalSchema } from "@changesafe/domain-network";
import {
  REVIEW_CONTRACT_VERSION,
  ReviewAnalysisModeSchema,
  ReviewAnalysisResultSchema,
  ReviewTransportErrorSchema,
} from "../../features/domains/review-contract";

/**
 * Wire contracts for application API routes. These are importable from client
 * code (no server dependencies) so both sides validate the same shapes.
 */

export const AnalyzeRequestSchema = z.strictObject({
  scenarioId: IdSchema,
  // The route produces analyses; it never accepts an offline proposal.
  mode: z.enum(["live", "replay"]),
});

export const AnalyzeSuccessSchema = z.strictObject({
  mode: AnalysisModeSchema,
  /** The model that answered a live call; null for authored replay fixtures. */
  model: z.string().max(64).nullable(),
  /** Which provider answered a live call; null in replay. */
  provider: z.string().max(32).nullable(),
  provenance: FixtureProvenanceSchema.nullable(),
  fixtureId: IdSchema.nullable(),
  /** Honest user-facing description of what a replay fixture is. */
  fixtureNotes: z.string().max(1000).nullable(),
  proposal: NetworkChangeProposalSchema,
});

export const ApiErrorCodeSchema = z.enum([
  "REQUEST_INVALID",
  "SCENARIO_UNKNOWN",
  "AI_UNAVAILABLE",
  "RATE_LIMITED",
  "AI_CALL_FAILED",
  "AI_INVALID_OUTPUT",
  "INTERNAL",
]);

export const AnalyzeErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    /** Safe to render; never contains secrets, stack traces, or raw model text. */
    message: z.string().min(1).max(500),
    /** True when the client should offer an explicit switch to replay mode. */
    replayAvailable: z.boolean(),
  }),
});

export const StatusResponseSchema = z.strictObject({
  liveAvailable: z.boolean(),
  /** Configured provider and model, or null when live mode is unconfigured.
   *  Never a credential, and never a promise that a call will succeed. */
  provider: z.string().max(32).nullable(),
  model: z.string().max(64).nullable(),
  appVersion: z.string().max(32),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AnalyzeSuccess = z.infer<typeof AnalyzeSuccessSchema>;
export type AnalyzeError = z.infer<typeof AnalyzeErrorSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const REVIEW_ANALYZE_API_VERSION = "v1" as const;

export const ReviewAnalyzeDomainIdV1Schema = z.enum([
  "network",
  "terraform",
  "kubernetes",
]);

export const ReviewAnalyzeRequestV1Schema = z.strictObject({
  apiVersion: z.literal(REVIEW_ANALYZE_API_VERSION),
  domainId: ReviewAnalyzeDomainIdV1Schema,
  contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
  sourceId: IdSchema,
  analysisMode: ReviewAnalysisModeSchema,
});

export const ReviewAnalyzeSuccessV1Schema = z.strictObject({
  apiVersion: z.literal(REVIEW_ANALYZE_API_VERSION),
  result: ReviewAnalysisResultSchema,
});

export const ReviewAnalyzeErrorV1Schema = z.strictObject({
  apiVersion: z.literal(REVIEW_ANALYZE_API_VERSION),
  result: ReviewTransportErrorSchema,
});

export type ReviewAnalyzeDomainIdV1 = z.infer<
  typeof ReviewAnalyzeDomainIdV1Schema
>;
export type ReviewAnalyzeRequestV1 = z.infer<
  typeof ReviewAnalyzeRequestV1Schema
>;
export type ReviewAnalyzeSuccessV1 = z.infer<
  typeof ReviewAnalyzeSuccessV1Schema
>;
export type ReviewAnalyzeErrorV1 = z.infer<
  typeof ReviewAnalyzeErrorV1Schema
>;
