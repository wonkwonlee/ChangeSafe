import {
  IncidentBundleSchema,
  ReplayFixtureSchema,
  ScenarioExpectationsSchema,
  type IncidentBundle,
  type ReplayFixture,
  type ScenarioExpectations,
} from "@/lib/domain/schemas";
import incidentA from "./scenario-a-failover/incident.json";
import fixtureA from "./scenario-a-failover/replay-fixture.json";
import expectationsA from "./scenario-a-failover/expectations.json";
import incidentB from "./scenario-b-route-leak/incident.json";
import fixtureB from "./scenario-b-route-leak/replay-fixture.json";
import expectationsB from "./scenario-b-route-leak/expectations.json";
import incidentC from "./scenario-c-route-flap/incident.json";
import fixtureC from "./scenario-c-route-flap/replay-fixture.json";
import expectationsC from "./scenario-c-route-flap/expectations.json";
import incidentD from "./scenario-d-egress-imbalance/incident.json";
import fixtureD from "./scenario-d-egress-imbalance/replay-fixture.json";
import expectationsD from "./scenario-d-egress-imbalance/expectations.json";
import incidentE from "./scenario-e-rollback-trap/incident.json";
import fixtureE from "./scenario-e-rollback-trap/replay-fixture.json";
import expectationsE from "./scenario-e-rollback-trap/expectations.json";
import incidentF from "./scenario-f-over-reach/incident.json";
import fixtureF from "./scenario-f-over-reach/replay-fixture.json";
import expectationsF from "./scenario-f-over-reach/expectations.json";

export interface ScenarioDefinition {
  scenarioId: string;
  /** Incident-styled label — describes the situation, never the expected verdict. */
  label: string;
  shortDescription: string;
  bundle: IncidentBundle;
  fixture: ReplayFixture;
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
 * bundle, fixture, or expectations file fails fast rather than shipping.
 */
function defineScenario(
  scenarioId: string,
  label: string,
  shortDescription: string,
  rawBundle: unknown,
  rawFixture: unknown,
  rawExpectations: unknown,
): ScenarioDefinition {
  const bundle = IncidentBundleSchema.parse(rawBundle);
  const fixture = ReplayFixtureSchema.parse(rawFixture);
  const expectations = ScenarioExpectationsSchema.parse(rawExpectations);
  if (fixture.scenarioId !== scenarioId) {
    throw new Error(
      `fixture "${fixture.fixtureId}" declares scenario "${fixture.scenarioId}", expected "${scenarioId}"`,
    );
  }
  if (expectations.scenarioId !== scenarioId) {
    throw new Error(
      `expectations declare scenario "${expectations.scenarioId}", expected "${scenarioId}"`,
    );
  }
  return { scenarioId, label, shortDescription, bundle, fixture, expectations };
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  defineScenario(
    "scenario-a-failover",
    "INC-4821 — Degraded primary uplink",
    "Primary WAN uplink on edge-rtr-01 shows CRC errors and packet loss; backup path is healthy.",
    incidentA,
    fixtureA,
    expectationsA,
  ),
  defineScenario(
    "scenario-b-route-leak",
    "INC-4977 — Suspected route leak",
    "Unexpected static route advertisement for the branch subnet; one operator note looks machine-injected.",
    incidentB,
    fixtureB,
    expectationsB,
  ),
  defineScenario(
    "scenario-c-route-flap",
    "INC-5133 — Transit route flapping",
    "The primary transit path on agg-rtr-01 keeps flapping; a stable standby path is idle.",
    incidentC,
    fixtureC,
    expectationsC,
  ),
  defineScenario(
    "scenario-d-egress-imbalance",
    "INC-5290 — Egress load imbalance",
    "One edge router is near its committed rate while its twin sits idle after a migration.",
    incidentD,
    fixtureD,
    expectationsD,
  ),
  defineScenario(
    "scenario-e-rollback-trap",
    "INC-5341 — Replication window overrun",
    "Nightly replication overruns its window on a congested shared circuit; an alternate path is idle.",
    incidentE,
    fixtureE,
    expectationsE,
  ),
  defineScenario(
    "scenario-f-over-reach",
    "INC-5388 — Intermittent access-layer loss",
    "Probe loss on a single access segment behind acc-rtr-06; neighbouring devices report healthy.",
    incidentF,
    fixtureF,
    expectationsF,
  ),
];

export function getScenario(scenarioId: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}
