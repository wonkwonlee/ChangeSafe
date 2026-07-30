import {
  ScenarioExpectationsSchema,
  type ChangeProposal,
  type FixtureProvenance,
  type ScenarioExpectations,
} from "@changesafe/core";
import { IncidentBundleSchema, NetworkReplayFixtureSchema } from "@changesafe/domain-network";

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

/** A fixture-derived proposal plus how it was produced. */
export interface NetworkScenarioFixture {
  fixtureId: string;
  proposal: ChangeProposal;
  provenance: FixtureProvenance;
  model: string | null;
  capturedAtUtc: string | null;
  notes: string;
}

/**
 * Network-only scenario registry, deliberately independent of
 * `scenarios/domains.ts` (which statically imports every domain package).
 * `components/ReviewWorkbenchShell.tsx` and the other files reachable from
 * `app/page.tsx` import this module rather than `scenarios/index.ts`, so the
 * Network public workbench route's static bundle never pulls in
 * `@changesafe/domain-terraform` or `@changesafe/domain-kubernetes` — see
 * `tests/unit/workbench-performance-boundaries.test.ts`.
 */
export interface NetworkScenarioDefinition {
  scenarioId: string;
  domainId: "network";
  /** Incident-styled label — describes the situation, never the expected verdict. */
  label: string;
  shortDescription: string;
  input: unknown;
  inputId: string;
  proposal: ChangeProposal;
  fixture: NetworkScenarioFixture;
  /** The machine-checked contract this scenario claims; see tests/integration. */
  expectations: ScenarioExpectations;
}

function defineNetworkScenario(
  scenarioId: string,
  label: string,
  shortDescription: string,
  rawInput: unknown,
  rawFixture: unknown,
  rawExpectations: unknown,
): NetworkScenarioDefinition {
  const input = IncidentBundleSchema.parse(rawInput);
  const expectations = ScenarioExpectationsSchema.parse(rawExpectations);
  if (expectations.scenarioId !== scenarioId) {
    throw new Error(
      `expectations declare scenario "${expectations.scenarioId}", expected "${scenarioId}"`,
    );
  }
  const declaredScenarioId = (rawFixture as { scenarioId?: unknown }).scenarioId;
  if (declaredScenarioId !== scenarioId) {
    throw new Error(
      `fixture declares scenario "${String(declaredScenarioId)}", expected "${scenarioId}"`,
    );
  }
  const fixture = NetworkReplayFixtureSchema.parse(rawFixture);
  return {
    scenarioId,
    domainId: "network",
    label,
    shortDescription,
    input,
    inputId: input.incidentId,
    proposal: fixture.proposal,
    fixture,
    expectations,
  };
}

export const NETWORK_SCENARIOS: readonly NetworkScenarioDefinition[] = [
  defineNetworkScenario(
    "scenario-a-failover",
    "INC-4821 — Degraded primary uplink",
    "Primary WAN uplink on edge-rtr-01 shows CRC errors and packet loss; backup path is healthy.",
    incidentA,
    fixtureA,
    expectationsA,
  ),
  defineNetworkScenario(
    "scenario-b-route-leak",
    "INC-4977 — Suspected route leak",
    "Unexpected static route advertisement for the branch subnet; one operator note looks machine-injected.",
    incidentB,
    fixtureB,
    expectationsB,
  ),
  defineNetworkScenario(
    "scenario-c-route-flap",
    "INC-5133 — Transit route flapping",
    "The primary transit path on agg-rtr-01 keeps flapping; a stable standby path is idle.",
    incidentC,
    fixtureC,
    expectationsC,
  ),
  defineNetworkScenario(
    "scenario-d-egress-imbalance",
    "INC-5290 — Egress load imbalance",
    "One edge router is near its committed rate while its twin sits idle after a migration.",
    incidentD,
    fixtureD,
    expectationsD,
  ),
  defineNetworkScenario(
    "scenario-e-rollback-trap",
    "INC-5341 — Replication window overrun",
    "Nightly replication overruns its window on a congested shared circuit; an alternate path is idle.",
    incidentE,
    fixtureE,
    expectationsE,
  ),
  defineNetworkScenario(
    "scenario-h-alert-injection",
    "INC-5744 — Firewall CPU saturation",
    "dist-fw-02 holds above 95% CPU; one alert arrives from an automated feed with directive text in its body.",
    incidentH,
    fixtureH,
    expectationsH,
  ),
  defineNetworkScenario(
    "scenario-i-command-smuggling",
    "INC-5810 — Branch aggregate black-holed",
    "Traffic to the branch aggregate is dropped at agg-rtr-04 after a maintenance window retired a next hop.",
    incidentI,
    fixtureI,
    expectationsI,
  ),
  defineNetworkScenario(
    "scenario-g-silent-regression",
    "INC-5602 — Idle standby transit path",
    "A cost review flags the standby transit circuit on agg-rtr-02 as unused for 30 days.",
    incidentG,
    fixtureG,
    expectationsG,
  ),
  defineNetworkScenario(
    "scenario-f-over-reach",
    "INC-5388 — Intermittent access-layer loss",
    "Probe loss on a single access segment behind acc-rtr-06; neighbouring devices report healthy.",
    incidentF,
    fixtureF,
    expectationsF,
  ),
];

export function getNetworkScenario(scenarioId: string): NetworkScenarioDefinition | undefined {
  return NETWORK_SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}
