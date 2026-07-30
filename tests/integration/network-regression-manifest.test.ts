import { describe, expect, it } from "vitest";

import {
  IllegalTransitionError,
  evaluatePolicies,
  hasBlockingFinding,
  initialState,
  transition,
  type SimulationResult,
  type WorkflowState,
} from "@changesafe/core";
import { networkDomain, runSimulation } from "@changesafe/domain-network";
import { NETWORK_REGRESSION_MANIFEST } from "@/tests/helpers/network-regression-manifest";
import { NETWORK_SCENARIOS, type NetworkScenarioDefinition } from "@/scenarios";
import type { IncidentBundle } from "@changesafe/domain-network";

function networkScenario(scenarioId: string): NetworkScenarioDefinition | undefined {
  return NETWORK_SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}

function advanceToDecision(scenario: NetworkScenarioDefinition): WorkflowState {
  const { findings, riskLevel } = evaluatePolicies(
    networkDomain,
    scenario.input as IncidentBundle,
    scenario.fixture.proposal,
  );
  let state: WorkflowState = initialState(scenario.scenarioId, scenario.input as IncidentBundle);
  state = transition(state, { type: "START_ANALYSIS", mode: "replay" });
  state = transition(state, {
    type: "PROPOSAL_RECEIVED",
    proposal: scenario.fixture.proposal,
    mode: "replay",
    provenance: scenario.fixture.provenance,
  });
  state = transition(state, { type: "VALIDATION_COMPLETED", findings, riskLevel });
  return transition(state, { type: "CLASSIFY" });
}

function attemptApproval(
  state: WorkflowState,
): { legal: boolean; state: WorkflowState } {
  try {
    return {
      legal: true,
      state: transition(state, { type: "APPROVE" }),
    };
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      return { legal: false, state };
    }
    throw error;
  }
}

function simulationTransitionIsLegal(
  state: WorkflowState,
  simulation: SimulationResult,
): boolean {
  try {
    transition(state, { type: "SIMULATION_COMPLETED", simulation });
    return true;
  } catch (error) {
    if (error instanceof IllegalTransitionError) return false;
    throw error;
  }
}

describe("current network regression manifest", () => {
  it.each(NETWORK_REGRESSION_MANIFEST)(
    "$scenarioId preserves its literal replay and gate contract",
    (expected) => {
      const scenario = networkScenario(expected.scenarioId);
      expect(
        scenario,
        `${expected.scenarioId} must remain in the production scenario registry`,
      ).toBeDefined();
      if (!scenario) return;

      const { findings, riskLevel } = evaluatePolicies(
        networkDomain,
        scenario.input as IncidentBundle,
        scenario.fixture.proposal,
      );
      const decisionState = advanceToDecision(scenario);
      const safeDonor = networkScenario("scenario-a-failover");
      if (!safeDonor) throw new Error("safe simulation donor missing");
      const knownValidSimulation = runSimulation(
        safeDonor.input as IncidentBundle,
        safeDonor.fixture.proposal,
      );
      const approvalAttempt = attemptApproval(decisionState);

      expect(scenario.fixture.provenance).toBe(expected.provenance);
      expect(hasBlockingFinding(findings) ? "BLOCK" : "PASS").toBe(
        expected.gateOutcome,
      );
      expect(riskLevel).toBe(expected.riskLevel);
      expect(approvalAttempt.legal).toBe(expected.approvalLegal);
      expect(
        simulationTransitionIsLegal(approvalAttempt.state, knownValidSimulation),
      ).toBe(
        expected.simulationEligible,
      );
    },
  );
});
