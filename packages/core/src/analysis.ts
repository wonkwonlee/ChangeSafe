import { z } from "zod";

export const AnalysisModeSchema = z.enum(["live", "replay"]);

/**
 * Honest provenance labels. A captured label may only be used when fixture
 * metadata evidences a real capture (model + capture time); authored content
 * must never be attributed to a model.
 */
export const FixtureProvenanceSchema = z.enum([
  "captured_gpt_5_6",
  "authored_red_team",
  "authored_synthetic",
]);

export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;
export type FixtureProvenance = z.infer<typeof FixtureProvenanceSchema>;
