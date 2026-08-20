import { describe, expect, it } from "vitest";

import { evaluatePolicies, hashCanonical } from "@changesafe/core";
import {
  kubernetesDomain,
  type KubernetesSnapshot,
} from "@changesafe/domain-kubernetes/offline";

import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import { KUBERNETES_REVIEW_EXAMPLES } from "@/features/domains/kubernetes/examples";
import {
  KUBERNETES_PUBLIC_REPLAY_FIXTURES,
  type KubernetesPublicReplayFixture,
} from "@/features/domains/kubernetes/fixtures";
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
  reviewControllerReducer,
  startReview,
} from "@/features/reviews/controller";

function exampleFor(fixture: KubernetesPublicReplayFixture) {
  const example = KUBERNETES_REVIEW_EXAMPLES.find(
    (candidate) => candidate.sourceId === fixture.sourceId,
  );
  if (!example) {
    throw new Error(`missing Kubernetes example for ${fixture.sourceId}`);
  }
  return example;
}

function replayRequest(fixture: KubernetesPublicReplayFixture): Request {
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

async function replayResult(fixture: KubernetesPublicReplayFixture) {
  const response = await reviewPost(replayRequest(fixture));
  expect(response.status, fixture.sourceId).toBe(200);
  return ReviewAnalyzeSuccessV1Schema.parse(await response.json()).result;
}

describe("Kubernetes public replay parity", () => {
  it.each(
    KUBERNETES_PUBLIC_REPLAY_FIXTURES.map((fixture) => [
      fixture.sourceId,
      fixture,
    ] as const),
  )(
    "%s preserves the independently evaluated fixture outcome in a decision-free public controller",
    async (_sourceId, fixture) => {
      const example = exampleFor(fixture);
      const result = await replayResult(fixture);
      const expected = evaluatePolicies(
        kubernetesDomain,
        fixture.snapshot,
        fixture.proposal,
      );

      // Fixture data, rather than route or controller output, is authoritative
      // for public replay provenance. Kubernetes bundled sources never claim a
      // model or provider produced their authored manifests.
      expect(result.provenance).toEqual({
        classification: fixture.provenance,
        model: null,
        provider: null,
        fixtureId: fixture.sourceId,
        notes: null,
      });
      expect(result.session).toEqual(example.session);
      expect(result.session).toMatchObject({
        domainShape: "simulated-state",
        runtimeMode: "public-replay",
        capabilities: {
          sandboxSimulation: true,
          durableDecision: false,
        },
      });

      // Hash the entire deterministic output tuple. This catches a route
      // changing proposal, policy ordering/findings, and risk together while
      // remaining independent of presentation text.
      expect(
        await hashCanonical({
          proposal: result.proposal,
          findings: result.findings,
          riskLevel: result.riskLevel,
        }),
      ).toBe(
        await hashCanonical({
          proposal: fixture.proposal,
          findings: expected.findings,
          riskLevel: expected.riskLevel,
        }),
      );

      let state = initialReviewControllerState<KubernetesSnapshot>({
        sourceId: fixture.sourceId,
        input: fixture.snapshot,
        expectedInputId: fixture.snapshot.snapshotId,
        session: example.session,
      });
      const attemptId = `attempt-kubernetes-parity-${fixture.sourceId}`;
      state = reviewControllerReducer(state, startReview(attemptId));
      state = reviewControllerReducer(
        state,
        receiveReviewTransport(attemptId, result),
      );

      expect(state.workflow.phase).toBe(
        expected.riskLevel === "CRITICAL" ? "BLOCKED" : "APPROVAL_REQUIRED",
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
