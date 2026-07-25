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
 * Honest provenance labels.
 *
 * `captured` may only be used when fixture metadata evidences a real capture
 * (which model, and when) — the schema rejects the claim otherwise. Authored
 * content must never be attributed to a model, and must declare `model: null`.
 *
 * The label names no vendor on purpose: a fixture captured from any provider
 * is equally a capture, and the model field already records which one. A
 * provider-shaped label would either exclude honest captures or invite
 * mislabeling them.
 */
export const FixtureProvenanceSchema = z.enum([
  "captured",
  "authored_red_team",
  "authored_synthetic",
]);

export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;
export type FixtureProvenance = z.infer<typeof FixtureProvenanceSchema>;
