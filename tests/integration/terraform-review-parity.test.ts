import { describe, expect, it } from "vitest";

import { evaluatePolicies, hashCanonical } from "@changesafe/core";
import {
  deriveProposal,
  normalizePlan,
  terraformDomain,
  type TerraformInput,
} from "@changesafe/domain-terraform";

import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import { TERRAFORM_REVIEW_EXAMPLES } from "@/features/domains/terraform/examples";
import {
  TERRAFORM_PUBLIC_REPLAY_FIXTURES,
  type TerraformPublicReplayFixture,
} from "@/features/domains/terraform/fixtures";
import {
  REVIEW_ANALYZE_API_VERSION,
  ReviewAnalyzeSuccessV1Schema,
} from "@/features/domains/review-api-contract";
import {
  approveReview,
  completeReviewSimulation,
  initialReviewControllerState,
  receiveReviewTransport,
  recordReviewReceipt,
  rejectReview,
  reviewCanSimulate,
  reviewControllerReducer,
  startReview,
} from "@/features/reviews/controller";

function exampleFor(fixture: TerraformPublicReplayFixture) {
  const example = TERRAFORM_REVIEW_EXAMPLES.find(
    (candidate) => candidate.sourceId === fixture.sourceId,
  );
  if (!example) {
    throw new Error(`missing Terraform example for ${fixture.sourceId}`);
  }
  return example;
}

function inputFor(fixture: TerraformPublicReplayFixture): TerraformInput {
  return normalizePlan(fixture.plan, {
    planId: fixture.inputId,
    context: [...fixture.context],
  });
}

function replayRequest(fixture: TerraformPublicReplayFixture): Request {
  const example = exampleFor(fixture);
  return new Request("http://localhost/api/reviews/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiVersion: REVIEW_ANALYZE_API_VERSION,
      domainId: example.domainId,
      contractVersion: example.contractVersion,
      sourceId: fixture.sourceId,
      analysisMode: "replay",
    }),
  });
}

describe("Terraform public replay parity", () => {
  it.each(
    TERRAFORM_PUBLIC_REPLAY_FIXTURES.map((fixture) =>
      [fixture.sourceId, fixture] as const,
    ),
  )(
    "%s preserves the supplied external diff's deterministic outcome while the public controller remains decision-free",
    async (_sourceId, fixture) => {
      const example = exampleFor(fixture);
      const input = inputFor(fixture);
      const expectedProposal = deriveProposal(input);
      const expected = evaluatePolicies(terraformDomain, input, expectedProposal);

      const response = await reviewPost(replayRequest(fixture));
      expect(response.status).toBe(200);
      const result = ReviewAnalyzeSuccessV1Schema.parse(
        await response.json(),
      ).result;

      // The route/controller result must remain equivalent to an independent
      // deterministic Terraform evaluation, rather than merely agreeing on
      // display-oriented status text.
      expect(
        await hashCanonical({
          proposal: result.proposal,
          findings: result.findings,
          riskLevel: result.riskLevel,
        }),
      ).toBe(
        await hashCanonical({
          proposal: expectedProposal,
          findings: expected.findings,
          riskLevel: expected.riskLevel,
        }),
      );
      expect(result.session).toEqual(example.session);
      expect(result.provenance).toEqual({
        classification: fixture.provenance,
        model: null,
        provider: null,
        fixtureId: fixture.sourceId,
        notes: null,
      });
      expect(result.effectCapability).toEqual({ kind: "external-diff" });
      expect(result.session.capabilities).toMatchObject({
        sandboxSimulation: false,
        durableDecision: false,
      });
      expect("simulate" in result).toBe(false);
      expect("decision" in result).toBe(false);
      expect("receipt" in result).toBe(false);

      let state = initialReviewControllerState<TerraformInput>({
        sourceId: fixture.sourceId,
        input,
        expectedInputId: fixture.inputId,
        session: example.session,
      });
      const attemptId = `attempt-parity-${fixture.sourceId}`;
      state = reviewControllerReducer(state, startReview(attemptId));
      state = reviewControllerReducer(
        state,
        receiveReviewTransport(attemptId, result),
      );

      expect(state.review?.effectCapability).toEqual({ kind: "external-diff" });
      expect(reviewCanSimulate(state)).toBe(false);
      expect(["APPROVAL_REQUIRED", "BLOCKED"]).toContain(state.workflow.phase);

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
