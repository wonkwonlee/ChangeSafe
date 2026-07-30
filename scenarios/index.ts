import { ScenarioExpectationsSchema, type ChangeProposal, type ScenarioExpectations } from "@changesafe/core";
import { resolveScenarioDomain, type ScenarioFixture } from "./domains";
import { NETWORK_SCENARIOS } from "./network";

export { NETWORK_SCENARIOS, getNetworkScenario, type NetworkScenarioDefinition } from "./network";

import planJ from "./terraform/scenario-j-destroy-protected/incident.json";
import expectationsJ from "./terraform/scenario-j-destroy-protected/expectations.json";
import planK from "./terraform/scenario-k-capacity-scale-up/incident.json";
import expectationsK from "./terraform/scenario-k-capacity-scale-up/expectations.json";
import planN from "./terraform/scenario-n-stateless-replace/incident.json";
import expectationsN from "./terraform/scenario-n-stateless-replace/expectations.json";
import planO from "./terraform/scenario-o-stateful-replace-backed-up/incident.json";
import expectationsO from "./terraform/scenario-o-stateful-replace-backed-up/expectations.json";

import snapshotL from "./kubernetes/scenario-l-replica-zero/incident.json";
import fixtureL from "./kubernetes/scenario-l-replica-zero/replay-fixture.json";
import expectationsL from "./kubernetes/scenario-l-replica-zero/expectations.json";
import snapshotM from "./kubernetes/scenario-m-selector-drift/incident.json";
import fixtureM from "./kubernetes/scenario-m-selector-drift/replay-fixture.json";
import expectationsM from "./kubernetes/scenario-m-selector-drift/expectations.json";

export interface ScenarioDefinition {
  scenarioId: string;
  domainId: string;
  /** Incident-styled label — describes the situation, never the expected verdict. */
  label: string;
  shortDescription: string;
  input: unknown;
  inputId: string;
  proposal: ChangeProposal;
  /**
   * Null for external-diff domains (terraform): the proposal is derived
   * mechanically from the input, so there is no separate authored-or-captured
   * fixture to declare provenance for.
   */
  fixture: ScenarioFixture | null;
  /** The machine-checked contract this scenario claims; see tests/integration. */
  expectations: ScenarioExpectations;
}

/**
 * Static imports (rather than filesystem discovery) keep this module usable in
 * the browser bundle. The scenario harness in tests/integration additionally
 * walks the scenarios directory, so a scenario added on disk but never
 * registered here fails CI instead of being silently ignored.
 *
 * Every scenario passes the production schemas at module load; a malformed
 * input, fixture, or expectations file fails fast rather than shipping.
 */
function defineScenario(
  domainId: string,
  scenarioId: string,
  label: string,
  shortDescription: string,
  rawInput: unknown,
  rawFixture: unknown,
  rawExpectations: unknown,
): ScenarioDefinition {
  const domain = resolveScenarioDomain(domainId);
  const input = domain.parseInput(rawInput);
  const expectations = ScenarioExpectationsSchema.parse(rawExpectations);
  if (expectations.scenarioId !== scenarioId) {
    throw new Error(
      `expectations declare scenario "${expectations.scenarioId}", expected "${scenarioId}"`,
    );
  }

  if (rawFixture !== null) {
    if (!domain.parseFixture) {
      throw new Error(`domain "${domainId}" derives its proposal and does not take a fixture`);
    }
    const declaredScenarioId = (rawFixture as { scenarioId?: unknown }).scenarioId;
    if (declaredScenarioId !== scenarioId) {
      throw new Error(
        `fixture declares scenario "${String(declaredScenarioId)}", expected "${scenarioId}"`,
      );
    }
    const fixture = domain.parseFixture(rawFixture);
    return {
      scenarioId,
      domainId,
      label,
      shortDescription,
      input,
      inputId: domain.inputId(input),
      proposal: fixture.proposal,
      fixture,
      expectations,
    };
  }

  if (!domain.deriveProposal) {
    throw new Error(`domain "${domainId}" has no fixture and cannot derive a proposal`);
  }
  return {
    scenarioId,
    domainId,
    label,
    shortDescription,
    inputId: domain.inputId(input),
    input,
    proposal: domain.deriveProposal(input),
    fixture: null,
    expectations,
  };
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  ...NETWORK_SCENARIOS,
  defineScenario(
    "terraform",
    "scenario-j-destroy-protected",
    "CHG-2201 — Retire an unused RDS instance",
    "A cleanup plan destroys what looks like an idle database, but it is tagged as the primary datastore.",
    planJ,
    null,
    expectationsJ,
  ),
  defineScenario(
    "terraform",
    "scenario-k-capacity-scale-up",
    "CHG-2340 — Scale up the checkout worker instance",
    "An instance-type bump plus a new CPU alarm for the checkout fleet; nothing is destroyed or replaced.",
    planK,
    null,
    expectationsK,
  ),
  defineScenario(
    "terraform",
    "scenario-n-stateless-replace",
    "CHG-2410 — Recreate the checkout worker instance for an AMI update",
    "A routine AMI bump forces Terraform to replace the checkout worker instance in place; nothing stateful is touched.",
    planN,
    null,
    expectationsN,
  ),
  defineScenario(
    "terraform",
    "scenario-o-stateful-replace-backed-up",
    "CHG-2418 — Resize the checkout read replica instance class",
    "An instance-class bump forces the checkout read replica to be destroyed and recreated; it is tagged as backed up.",
    planO,
    null,
    expectationsO,
  ),
  defineScenario(
    "kubernetes",
    "scenario-l-replica-zero",
    "CHG-3110 — Scale down the checkout Deployment",
    "A capacity-reduction change sets checkout's replica count to zero instead of the intended partial scale-down.",
    snapshotL,
    fixtureL,
    expectationsL,
  ),
  defineScenario(
    "kubernetes",
    "scenario-m-selector-drift",
    "CHG-3187 — Relabel the payments Deployment",
    "A labeling cleanup on the payments Deployment drifts its pod template away from the Service selector that routes to it.",
    snapshotM,
    fixtureM,
    expectationsM,
  ),
];

export function getScenario(scenarioId: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}
