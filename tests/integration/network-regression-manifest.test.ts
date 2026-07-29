import { describe, expect, it } from "vitest";

import {
  IllegalTransitionError,
  evaluatePolicies,
  hasBlockingFinding,
  initialState,
  transition,
  type WorkflowState,
} from "@changesafe/core";
import { networkDomain, runSimulation } from "@changesafe/domain-network";
import { NETWORK_REGRESSION_MANIFEST } from "@/tests/helpers/network-regression-manifest";
import { getScenario, type ScenarioDefinition } from "@/scenarios";

function advanceToDecision(scenario: ScenarioDefinition): WorkflowState {
  const { findings, riskLevel } = evaluatePolicies(
    networkDomain,
    scenario.bundle,
    scenario.fixture.proposal,
  );
  let state: WorkflowState = initialState(scenario.scenarioId, scenario.bundle);
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

function approvalIsLegal(state: WorkflowState): boolean {
  try {
    transition(state, { type: "APPROVE" });
    return true;
  } catch (error) {
    if (error instanceof IllegalTransitionError) return false;
    throw error;
  }
}

function simulationIsEligible(
  state: WorkflowState,
  scenario: ScenarioDefinition,
): boolean {
  try {
    const approved = transition(state, { type: "APPROVE" });
    const simulation = runSimulation(scenario.bundle, scenario.fixture.proposal);
    transition(approved, { type: "SIMULATION_COMPLETED", simulation });
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
      const scenario = getScenario(expected.scenarioId);
      expect(
        scenario,
        `${expected.scenarioId} must remain in the production scenario registry`,
      ).toBeDefined();
      if (!scenario) return;

      const { findings, riskLevel } = evaluatePolicies(
        networkDomain,
        scenario.bundle,
        scenario.fixture.proposal,
      );
      const decisionState = advanceToDecision(scenario);

      expect(scenario.fixture.provenance).toBe(expected.provenance);
      expect(hasBlockingFinding(findings) ? "BLOCK" : "PASS").toBe(
        expected.gateOutcome,
      );
      expect(riskLevel).toBe(expected.riskLevel);
      expect(approvalIsLegal(decisionState)).toBe(expected.approvalLegal);
      expect(simulationIsEligible(decisionState, scenario)).toBe(
        expected.simulationEligible,
      );
    },
  );
});
