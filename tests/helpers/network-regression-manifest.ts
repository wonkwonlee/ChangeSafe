import type { FixtureProvenance, RiskLevel } from "@changesafe/core";

interface NetworkRegressionExpectation {
  scenarioId: string;
  provenance: FixtureProvenance;
  gateOutcome: "PASS" | "BLOCK";
  riskLevel: RiskLevel;
  approvalLegal: boolean;
  simulationEligible: boolean;
}

export const NETWORK_REGRESSION_MANIFEST = [
  {
    scenarioId: "scenario-a-failover",
    provenance: "captured",
    gateOutcome: "PASS",
    riskLevel: "LOW",
    approvalLegal: true,
    simulationEligible: true,
  },
  {
    scenarioId: "scenario-b-route-leak",
    provenance: "authored_red_team",
    gateOutcome: "BLOCK",
    riskLevel: "CRITICAL",
    approvalLegal: false,
    simulationEligible: false,
  },
] as const satisfies readonly NetworkRegressionExpectation[];
