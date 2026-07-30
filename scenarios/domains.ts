import type { ChangeProposal, DomainAdapter, FixtureProvenance, SimulationResult } from "@changesafe/core";
import { NetworkReplayFixtureSchema, IncidentBundleSchema, networkDomain, runSimulation } from "@changesafe/domain-network";
import { deriveProposal, normalizePlan, terraformDomain, type TerraformInput } from "@changesafe/domain-terraform";
import {
  KubernetesReplayFixtureSchema,
  kubernetesDomain,
  normalizeSnapshot,
  runKubernetesSimulation,
} from "@changesafe/domain-kubernetes";

/** A fixture-derived proposal plus how it was produced, normalized across domains. */
export interface ScenarioFixture {
  fixtureId: string;
  proposal: ChangeProposal;
  provenance: FixtureProvenance;
  model: string | null;
  capturedAtUtc: string | null;
  notes: string;
}

/**
 * What the scenario harness needs to load and exercise a scenario for one
 * domain, without any Node-only I/O — this module must stay usable in the
 * browser bundle, unlike `packages/cli/src/domains.ts`'s heavier CLI-facing
 * registry (which reads files and throws `UsageError`).
 *
 * Two domain shapes, matching `DomainAdapter`'s own split:
 *
 * - `parseFixture` — a simulated-state domain (network, kubernetes) ships a
 *   `replay-fixture.json` carrying an authored-or-captured proposal plus
 *   provenance, and can simulate the outcome.
 * - `deriveProposal` — an external-diff domain (terraform) has no fixture at
 *   all: the plan already is the proposal, so persisting a derived copy
 *   would just be a redundant artifact. There is nothing to simulate.
 *
 * Exactly one of the two is present per domain.
 */
export interface ScenarioDomain {
  readonly domainId: string;
  readonly adapter: DomainAdapter<never, never>;
  parseInput(raw: unknown): unknown;
  /** The input's own natural identifier, for receipts (incidentId, planId, snapshotId). */
  inputId(input: unknown): string;
  parseFixture?(raw: unknown): ScenarioFixture;
  deriveProposal?(input: unknown): ChangeProposal;
  simulate?(input: unknown, proposal: ChangeProposal): SimulationResult;
}

const network: ScenarioDomain = {
  domainId: "network",
  adapter: networkDomain as unknown as DomainAdapter<never, never>,
  parseInput: (raw) => IncidentBundleSchema.parse(raw),
  inputId: (input) => (input as { incidentId: string }).incidentId,
  parseFixture: (raw) => normalizeFixture(NetworkReplayFixtureSchema.parse(raw)),
  simulate: (input, proposal) => runSimulation(input as never, proposal),
};

const terraform: ScenarioDomain = {
  domainId: "terraform",
  adapter: terraformDomain as unknown as DomainAdapter<never, never>,
  parseInput: (raw) => normalizePlan(raw),
  inputId: (input) => (input as TerraformInput).planId,
  deriveProposal: (input) => deriveProposal(input as TerraformInput),
};

const kubernetes: ScenarioDomain = {
  domainId: "kubernetes",
  adapter: kubernetesDomain as unknown as DomainAdapter<never, never>,
  parseInput: (raw) => normalizeSnapshot(raw),
  inputId: (input) => (input as { snapshotId: string }).snapshotId,
  parseFixture: (raw) => normalizeFixture(KubernetesReplayFixtureSchema.parse(raw)),
  simulate: (input, proposal) => runKubernetesSimulation(input as never, proposal),
};

function normalizeFixture(fixture: {
  fixtureId: string;
  provenance: FixtureProvenance;
  model: string | null;
  capturedAtUtc: string | null;
  notes: string;
  proposal: ChangeProposal;
}): ScenarioFixture {
  return fixture;
}

export const SCENARIO_DOMAINS: Record<string, ScenarioDomain> = { network, terraform, kubernetes };

export const SCENARIO_DOMAIN_IDS = Object.keys(SCENARIO_DOMAINS);

export function resolveScenarioDomain(domainId: string): ScenarioDomain {
  const domain = SCENARIO_DOMAINS[domainId];
  if (!domain) {
    throw new Error(`unknown scenario domain "${domainId}". Available: ${SCENARIO_DOMAIN_IDS.join(", ")}`);
  }
  return domain;
}
