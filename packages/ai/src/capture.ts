import { DomainError, ReplayFixtureSchema, type ReplayFixture } from "@changesafe/core";

import type { AnalysisResult } from "./analyze";

export interface CaptureOptions {
  readonly scenarioId: string;
  readonly fixtureId?: string;
  readonly notes?: string;
  /** Supplied by the caller: nothing in this package reads a clock. */
  readonly capturedAtUtc: string;
}

/**
 * Turn a real model response into a replay fixture that says so.
 *
 * Provenance is the whole point of this function. A fixture produced here
 * carries `captured` along with the model that produced it and when — the
 * schema refuses a captured claim without both. Authored fixtures, written by
 * hand, must declare `model: null`, so there is no way to hand-write a file
 * that passes itself off as model output, and no way for a real capture to
 * lose its attribution.
 */
export function captureFixture(analysis: AnalysisResult, options: CaptureOptions): ReplayFixture {
  const fixtureId = options.fixtureId ?? `${options.scenarioId}-capture-${analysis.provider}`;

  const candidate = {
    fixtureId,
    scenarioId: options.scenarioId,
    provenance: "captured" as const,
    model: analysis.model,
    capturedAtUtc: options.capturedAtUtc,
    notes:
      options.notes ??
      `Captured from ${analysis.provider} model ${analysis.model} at ${options.capturedAtUtc}. Accepted only after schema and evidence validation.`,
    proposal: analysis.proposal,
  };

  const parsed = ReplayFixtureSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new DomainError(
      "FIXTURE_INVALID",
      `The captured response could not be written as a replay fixture (${issues}).`,
    );
  }
  return parsed.data;
}
