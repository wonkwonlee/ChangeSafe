import type { ChangeProposal, ScenarioExpectations } from "@changesafe/core";
import type { ScenarioFixture } from "./domains";
import { KUBERNETES_SCENARIOS } from "./kubernetes";
import { NETWORK_SCENARIOS } from "./network";
import { TERRAFORM_SCENARIOS } from "./terraform";

export { NETWORK_SCENARIOS, getNetworkScenario, type NetworkScenarioDefinition } from "./network";
export {
  TERRAFORM_SCENARIOS,
  getTerraformScenario,
  type TerraformScenarioDefinition,
} from "./terraform";
export {
  KUBERNETES_SCENARIOS,
  getKubernetesScenario,
  type KubernetesScenarioDefinition,
} from "./kubernetes";

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
 * The cross-domain view of the corpus, composed from the three single-domain
 * registries rather than re-declaring them. Each of those registries statically
 * imports its own scenario JSON (rather than discovering it on disk) so it stays
 * usable in a browser bundle, and validates every scenario against the
 * production schemas at module load — a malformed input, fixture, or
 * expectations file fails fast rather than shipping.
 *
 * Splitting per domain is what keeps a public workbench route's static bundle
 * free of the other domains' packages; this module pulls in all three and is
 * therefore reachable only from server-side and test code. The scenario harness
 * in tests/integration additionally walks the scenarios directory, so a
 * scenario added on disk but never registered in its domain's module fails CI
 * instead of being silently ignored.
 */
export const SCENARIOS: readonly ScenarioDefinition[] = [
  ...NETWORK_SCENARIOS,
  ...TERRAFORM_SCENARIOS,
  ...KUBERNETES_SCENARIOS,
];

export function getScenario(scenarioId: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}
