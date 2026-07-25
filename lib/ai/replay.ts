import { DomainError } from "@changesafe/core";
import type { ChangeProposal, FixtureProvenance } from "@changesafe/core";
import { getScenario } from "@/scenarios";
import { validateModelProposal } from "./validate-model-output";

export interface ReplayAnalysis {
  proposal: ChangeProposal;
  provenance: FixtureProvenance;
  /** Non-null only for fixtures captured from a real model response. */
  model: string | null;
  fixtureId: string;
  fixtureNotes: string;
}

/**
 * Replay skips only the network call. The fixture's proposal goes through the
 * same local validation as live model output, so replay and live exercise an
 * identical downstream pipeline.
 */
export function analyzeReplay(scenarioId: string): ReplayAnalysis {
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new DomainError("REQUEST_INVALID", `Unknown scenario "${scenarioId}".`);
  }

  const { fixture } = scenario;
  const proposal = validateModelProposal(scenario.bundle, fixture.proposal);

  return {
    proposal,
    provenance: fixture.provenance,
    model: fixture.model,
    fixtureId: fixture.fixtureId,
    fixtureNotes: fixture.notes,
  };
}
