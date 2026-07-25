import { z } from "zod";

/**
 * How the proposal under evaluation was produced.
 *
 * - `live`    — this run called a model.
 * - `replay`  — this run loaded a labeled fixture.
 * - `offline` — the proposal was handed to the gate (a file, a CI artifact);
 *   this run produced nothing and attests nothing about its origin.
 */
export const AnalysisModeSchema = z.enum(["live", "replay", "offline"]);

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
