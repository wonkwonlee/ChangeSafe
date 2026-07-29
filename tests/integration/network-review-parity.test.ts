import { describe, expect, it } from "vitest";

import {
  evaluatePolicies,
  hashCanonical,
  type FixtureProvenance,
} from "@changesafe/core";
import { networkDomain, type IncidentBundle } from "@changesafe/domain-network";

import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import { NETWORK_REVIEW_EXAMPLES } from "@/features/domains/network/examples";
import { REVIEW_ANALYZE_API_VERSION, ReviewAnalyzeSuccessV1Schema } from "@/features/domains/review-api-contract";
import { approveReview, completeReviewSimulation, initialReviewControllerState, receiveReviewTransport, recordReviewReceipt, rejectReview, reviewControllerReducer, startReview } from "@/features/reviews/controller";
import { SCENARIOS, type ScenarioDefinition } from "@/scenarios";

function exampleFor(scenario: ScenarioDefinition) {
  const example = NETWORK_REVIEW_EXAMPLES.find(
    (candidate) => candidate.sourceId === scenario.scenarioId,
  );
  if (!example) throw new Error(`missing Network example for ${scenario.scenarioId}`);
  return example;
}

function replayRequest(scenario: ScenarioDefinition): Request {
  const example = exampleFor(scenario);
  return new Request("http://localhost/api/reviews/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiVersion: REVIEW_ANALYZE_API_VERSION,
      domainId: example.domainId,
      contractVersion: example.contractVersion,
      sourceId: scenario.scenarioId,
      analysisMode: "replay",
    }),
  });
}

async function replayResult(scenario: ScenarioDefinition) {
  const response = await reviewPost(replayRequest(scenario));
  expect(response.status, scenario.scenarioId).toBe(200);
  return ReviewAnalyzeSuccessV1Schema.parse(await response.json()).result;
}

function expectedReplayClassification(
  provenance: FixtureProvenance,
): "captured-replay" | "authored-synthetic" | "authored-red-team" {
  switch (provenance) {
    case "captured":
      return "captured-replay";
    case "authored_synthetic":
      return "authored-synthetic";
    case "authored_red_team":
      return "authored-red-team";
  }
}

describe("Network public replay parity", () => {
  it.each(SCENARIOS.map((scenario) => [scenario.scenarioId, scenario] as const))(
    "%s preserves the fixture's exact deterministic outcome while the V1 public controller remains decision-free",
    async (_scenarioId, scenario) => {
      const example = exampleFor(scenario);
      const result = await replayResult(scenario);
      // Assert the public result before it can enter the controller. The
      // fixture, rather than any route or controller output, is authoritative
      // for replay provenance and model attribution.
      expect(result.provenance).toEqual({
        classification: expectedReplayClassification(scenario.fixture.provenance),
        model: scenario.fixture.model,
        provider: null,
        fixtureId: scenario.fixture.fixtureId,
        notes: scenario.fixture.notes,
      });
      const expected = evaluatePolicies(
        networkDomain,
        scenario.bundle,
        scenario.fixture.proposal,
      );

      // Compare canonical representations rather than display copy. This
      // proves proposal, ordered findings, and risk cannot drift together.
      expect(
        await hashCanonical({
          proposal: result.proposal,
          findings: result.findings,
          riskLevel: result.riskLevel,
        }),
      ).toBe(
        await hashCanonical({
          proposal: scenario.fixture.proposal,
          findings: expected.findings,
          riskLevel: expected.riskLevel,
        }),
      );
      expect(result.session).toEqual(example.session);
      expect(result.riskLevel).toBe(scenario.expectations.riskLevel);

      let state = initialReviewControllerState<IncidentBundle>({
        sourceId: scenario.scenarioId,
        input: scenario.bundle,
        expectedInputId: scenario.bundle.incidentId,
        session: example.session,
      });
      const attemptId = `attempt-parity-${scenario.scenarioId}`;
      state = reviewControllerReducer(state, startReview(attemptId));
      state = reviewControllerReducer(
        state,
        receiveReviewTransport(attemptId, result),
      );

      expect(state.workflow.phase).toBe(
        scenario.expectations.approvable ? "APPROVAL_REQUIRED" : "BLOCKED",
      );
      const reviewed = state;
      state = reviewControllerReducer(state, approveReview());
      expect(state).toBe(reviewed);
      state = reviewControllerReducer(state, rejectReview());
      expect(state).toBe(reviewed);
      state = reviewControllerReducer(
        state,
        completeReviewSimulation({ status: "completed" }),
      );
      expect(state).toBe(reviewed);
      await expect(recordReviewReceipt(state, {})).rejects.toThrow(
        /public replay.*receipt/i,
      );
    },
  );
});
