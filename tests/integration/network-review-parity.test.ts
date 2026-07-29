import { describe, expect, it } from "vitest";

import {
  IllegalTransitionError,
  createReceipt,
  evaluatePolicies,
  hashCanonical,
  verifyReceiptHash,
} from "@changesafe/core";
import {
  networkDomain,
  runSimulation,
  type IncidentBundle,
} from "@changesafe/domain-network";

import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import { NETWORK_REVIEW_EXAMPLES } from "@/features/domains/network/examples";
import { createNetworkReviewReceipt } from "@/features/domains/network/receipt";
import { REVIEW_ANALYZE_API_VERSION, ReviewAnalyzeSuccessV1Schema } from "@/features/domains/review-api-contract";
import { approveReview, completeReviewSimulation, initialReviewControllerState, receiveReviewTransport, recordReviewReceipt, reviewControllerReducer, startReview } from "@/features/reviews/controller";
import { SCENARIOS, type ScenarioDefinition } from "@/scenarios";

const APP_VERSION = "parity-test";
const CREATED_AT = "2026-07-29T00:00:00.000Z";

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

function expectedReceiptInput(
  state: ReturnType<typeof initialReviewControllerState<IncidentBundle>>,
  scenario: ScenarioDefinition,
) {
  if (state.review === null) throw new Error("completed review required for a receipt");

  switch (state.workflow.phase) {
    case "BLOCKED":
      return {
        sourceId: scenario.scenarioId,
        inputId: scenario.bundle.incidentId,
        input: scenario.bundle,
        appVersion: APP_VERSION,
        policyVersion: state.session.policyVersion,
        proposal: state.workflow.proposal,
        mode: state.workflow.mode,
        model: state.review.provenance.model,
        fixtureProvenance: state.workflow.provenance,
        findings: state.workflow.findings,
        riskLevel: state.workflow.riskLevel,
        decision: "blocked" as const,
        simulation: null,
        createdAtUtc: CREATED_AT,
        receiptId: `rcpt-parity-${scenario.scenarioId}`,
      };
    case "SIMULATED":
      return {
        sourceId: scenario.scenarioId,
        inputId: scenario.bundle.incidentId,
        input: scenario.bundle,
        appVersion: APP_VERSION,
        policyVersion: state.session.policyVersion,
        proposal: state.workflow.proposal,
        mode: state.workflow.mode,
        model: state.review.provenance.model,
        fixtureProvenance: state.workflow.provenance,
        findings: state.workflow.findings,
        riskLevel: state.workflow.riskLevel,
        decision: "approved" as const,
        simulation: state.workflow.simulation,
        createdAtUtc: CREATED_AT,
        receiptId: `rcpt-parity-${scenario.scenarioId}`,
      };
    default:
      throw new Error(`receipt parity cannot continue from ${state.workflow.phase}`);
  }
}

describe("Network public replay parity", () => {
  it.each(SCENARIOS.map((scenario) => [scenario.scenarioId, scenario] as const))(
    "%s preserves the fixture's exact deterministic outcome through the V1 workbench path",
    async (_scenarioId, scenario) => {
      const example = exampleFor(scenario);
      const result = await replayResult(scenario);
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

      if (!scenario.expectations.approvable) {
        expect(state.workflow.phase).toBe("BLOCKED");
        expect(() => reviewControllerReducer(state, approveReview())).toThrow(
          IllegalTransitionError,
        );

        // This is the legacy durable-record compatibility path, not a public
        // workbench action. The generated record must remain byte-for-byte
        // identical to a receipt built from the fixture-derived core result.
        const receipt = await createNetworkReviewReceipt(state, {
          appVersion: APP_VERSION,
          createdAtUtc: CREATED_AT,
          receiptId: `rcpt-parity-${scenario.scenarioId}`,
        });
        expect(receipt).toEqual(await createReceipt(expectedReceiptInput(state, scenario)));
        expect(await verifyReceiptHash(receipt)).toBe(true);
        state = reviewControllerReducer(state, await recordReviewReceipt(state, receipt));
        expect(state.workflow.phase).toBe("RECEIPT_ISSUED");
        return;
      }

      expect(state.workflow.phase).toBe("APPROVAL_REQUIRED");
      state = reviewControllerReducer(state, approveReview());
      if (state.workflow.phase !== "APPROVED") {
        throw new Error("approvable fixture did not reach APPROVED");
      }
      state = reviewControllerReducer(
        state,
        completeReviewSimulation(
          runSimulation(state.workflow.input, state.workflow.proposal),
        ),
      );
      expect(state.workflow.phase).toBe("SIMULATED");

      const receipt = await createNetworkReviewReceipt(state, {
        appVersion: APP_VERSION,
        createdAtUtc: CREATED_AT,
        receiptId: `rcpt-parity-${scenario.scenarioId}`,
      });
      expect(receipt).toEqual(await createReceipt(expectedReceiptInput(state, scenario)));
      expect(await verifyReceiptHash(receipt)).toBe(true);
      state = reviewControllerReducer(state, await recordReviewReceipt(state, receipt));
      expect(state.workflow.phase).toBe("RECEIPT_ISSUED");
    },
  );
});
