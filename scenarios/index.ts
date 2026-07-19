import {
  IncidentBundleSchema,
  ReplayFixtureSchema,
  type IncidentBundle,
  type ReplayFixture,
} from "@/lib/domain/schemas";
import incidentA from "./scenario-a-failover/incident.json";
import fixtureA from "./scenario-a-failover/replay-fixture.json";
import incidentB from "./scenario-b-route-leak/incident.json";
import fixtureB from "./scenario-b-route-leak/replay-fixture.json";

export interface ScenarioDefinition {
  scenarioId: string;
  /** Incident-styled label — describes the situation, never the expected verdict. */
  label: string;
  shortDescription: string;
  bundle: IncidentBundle;
  fixture: ReplayFixture;
}

/**
 * Bundled scenarios pass the exact production schemas at module load; a
 * malformed fixture fails fast rather than shipping. Fixture scenarioId must
 * match its scenario directory entry.
 */
function defineScenario(
  scenarioId: string,
  label: string,
  shortDescription: string,
  rawBundle: unknown,
  rawFixture: unknown,
): ScenarioDefinition {
  const bundle = IncidentBundleSchema.parse(rawBundle);
  const fixture = ReplayFixtureSchema.parse(rawFixture);
  if (fixture.scenarioId !== scenarioId) {
    throw new Error(
      `fixture "${fixture.fixtureId}" declares scenario "${fixture.scenarioId}", expected "${scenarioId}"`,
    );
  }
  return { scenarioId, label, shortDescription, bundle, fixture };
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  defineScenario(
    "scenario-a-failover",
    "INC-4821 — Degraded primary uplink",
    "Primary WAN uplink on edge-rtr-01 shows CRC errors and packet loss; backup path is healthy.",
    incidentA,
    fixtureA,
  ),
  defineScenario(
    "scenario-b-route-leak",
    "INC-4977 — Suspected route leak",
    "Unexpected static route advertisement for the branch subnet; one operator note looks machine-injected.",
    incidentB,
    fixtureB,
  ),
];

export function getScenario(scenarioId: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}
