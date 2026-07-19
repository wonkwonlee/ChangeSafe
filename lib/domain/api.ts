import { z } from "zod";
import {
  AnalysisModeSchema,
  ChangeProposalSchema,
  FixtureProvenanceSchema,
  IdSchema,
} from "./schemas";

/**
 * Wire contracts for the two API routes. These are importable from client
 * code (no server dependencies) so both sides validate the same shapes.
 */

export const AnalyzeRequestSchema = z.strictObject({
  scenarioId: IdSchema,
  mode: AnalysisModeSchema,
});

export const AnalyzeSuccessSchema = z.strictObject({
  mode: AnalysisModeSchema,
  /** Runtime model for live analyses; null for authored replay fixtures. */
  model: z.string().max(64).nullable(),
  provenance: FixtureProvenanceSchema.nullable(),
  fixtureId: IdSchema.nullable(),
  /** Honest user-facing description of what a replay fixture is. */
  fixtureNotes: z.string().max(1000).nullable(),
  proposal: ChangeProposalSchema,
});

export const ApiErrorCodeSchema = z.enum([
  "REQUEST_INVALID",
  "SCENARIO_UNKNOWN",
  "AI_UNAVAILABLE",
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
  model: z.string().max(64),
  appVersion: z.string().max(32),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AnalyzeSuccess = z.infer<typeof AnalyzeSuccessSchema>;
export type AnalyzeError = z.infer<typeof AnalyzeErrorSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
