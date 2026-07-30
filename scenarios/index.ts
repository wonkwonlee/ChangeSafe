import { ScenarioExpectationsSchema, type ChangeProposal, type ScenarioExpectations } from "@changesafe/core";
import { resolveScenarioDomain, type ScenarioFixture } from "./domains";

import incidentA from "./network/scenario-a-failover/incident.json";
import fixtureA from "./network/scenario-a-failover/replay-fixture.json";
import expectationsA from "./network/scenario-a-failover/expectations.json";
import incidentB from "./network/scenario-b-route-leak/incident.json";
import fixtureB from "./network/scenario-b-route-leak/replay-fixture.json";
import expectationsB from "./network/scenario-b-route-leak/expectations.json";
import incidentC from "./network/scenario-c-route-flap/incident.json";
import fixtureC from "./network/scenario-c-route-flap/replay-fixture.json";
import expectationsC from "./network/scenario-c-route-flap/expectations.json";
import incidentD from "./network/scenario-d-egress-imbalance/incident.json";
import fixtureD from "./network/scenario-d-egress-imbalance/replay-fixture.json";
import expectationsD from "./network/scenario-d-egress-imbalance/expectations.json";
import incidentE from "./network/scenario-e-rollback-trap/incident.json";
import fixtureE from "./network/scenario-e-rollback-trap/replay-fixture.json";
import expectationsE from "./network/scenario-e-rollback-trap/expectations.json";
import incidentF from "./network/scenario-f-over-reach/incident.json";
import fixtureF from "./network/scenario-f-over-reach/replay-fixture.json";
import expectationsF from "./network/scenario-f-over-reach/expectations.json";
import incidentG from "./network/scenario-g-silent-regression/incident.json";
import fixtureG from "./network/scenario-g-silent-regression/replay-fixture.json";
import expectationsG from "./network/scenario-g-silent-regression/expectations.json";
import incidentH from "./network/scenario-h-alert-injection/incident.json";
import fixtureH from "./network/scenario-h-alert-injection/replay-fixture.json";
import expectationsH from "./network/scenario-h-alert-injection/expectations.json";
import incidentI from "./network/scenario-i-command-smuggling/incident.json";
import fixtureI from "./network/scenario-i-command-smuggling/replay-fixture.json";
import expectationsI from "./network/scenario-i-command-smuggling/expectations.json";

import planJ from "./terraform/scenario-j-destroy-protected/incident.json";
import expectationsJ from "./terraform/scenario-j-destroy-protected/expectations.json";
import planK from "./terraform/scenario-k-capacity-scale-up/incident.json";
import expectationsK from "./terraform/scenario-k-capacity-scale-up/expectations.json";

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
  defineScenario(
    "network",
    "scenario-a-failover",
    "INC-4821 — Degraded primary uplink",
    "Primary WAN uplink on edge-rtr-01 shows CRC errors and packet loss; backup path is healthy.",
    incidentA,
    fixtureA,
    expectationsA,
  ),
  defineScenario(
    "network",
    "scenario-b-route-leak",
    "INC-4977 — Suspected route leak",
    "Unexpected static route advertisement for the branch subnet; one operator note looks machine-injected.",
    incidentB,
    fixtureB,
    expectationsB,
  ),
  defineScenario(
    "network",
    "scenario-c-route-flap",
    "INC-5133 — Transit route flapping",
    "The primary transit path on agg-rtr-01 keeps flapping; a stable standby path is idle.",
    incidentC,
    fixtureC,
    expectationsC,
  ),
  defineScenario(
    "network",
    "scenario-d-egress-imbalance",
    "INC-5290 — Egress load imbalance",
    "One edge router is near its committed rate while its twin sits idle after a migration.",
    incidentD,
    fixtureD,
    expectationsD,
  ),
  defineScenario(
    "network",
    "scenario-e-rollback-trap",
    "INC-5341 — Replication window overrun",
    "Nightly replication overruns its window on a congested shared circuit; an alternate path is idle.",
    incidentE,
    fixtureE,
    expectationsE,
  ),
  defineScenario(
    "network",
    "scenario-h-alert-injection",
    "INC-5744 — Firewall CPU saturation",
    "dist-fw-02 holds above 95% CPU; one alert arrives from an automated feed with directive text in its body.",
    incidentH,
    fixtureH,
    expectationsH,
  ),
  defineScenario(
    "network",
    "scenario-i-command-smuggling",
    "INC-5810 — Branch aggregate black-holed",
    "Traffic to the branch aggregate is dropped at agg-rtr-04 after a maintenance window retired a next hop.",
    incidentI,
    fixtureI,
    expectationsI,
  ),
  defineScenario(
    "network",
    "scenario-g-silent-regression",
    "INC-5602 — Idle standby transit path",
    "A cost review flags the standby transit circuit on agg-rtr-02 as unused for 30 days.",
    incidentG,
    fixtureG,
    expectationsG,
  ),
  defineScenario(
    "network",
    "scenario-f-over-reach",
    "INC-5388 — Intermittent access-layer loss",
    "Probe loss on a single access segment behind acc-rtr-06; neighbouring devices report healthy.",
    incidentF,
    fixtureF,
    expectationsF,
  ),
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

export const NETWORK_SCENARIOS: readonly ScenarioDefinition[] = SCENARIOS.filter(
  (scenario) => scenario.domainId === "network",
);

export function getScenario(scenarioId: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}
