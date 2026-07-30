import { describe, expect, it } from "vitest";

import {
  INITIAL_SELF_HOSTED_REVIEW_VIEW_STATE,
  selfHostedReviewViewReducer,
  type ReviewAttempt,
} from "@/features/reviews/selfHostedReviewViewState";
import type { SelfHostedReviewEntry } from "@/features/reviews/selfHostedReviewTransport";

function review(reviewId: string): SelfHostedReviewEntry {
  return {
    seq: 1,
    reviewId,
    createdAtUtc: "2026-07-30T12:00:00.000Z",
    domainId: "network",
    sourceId: "network-source",
    inputId: "network-input",
    record: {
      recordVersion: "2",
      reviewId,
      createdAtUtc: "2026-07-30T12:00:00.000Z",
      owner: {
        tenantId: "https://idp.example.test",
        issuer: "https://idp.example.test",
        subject: "alice",
        scope: "self-hosted-review",
      },
      session: {
        domainId: "network",
        contractVersion: "2.0.0",
        policyVersion: "core-v1+network-v1",
        domainShape: "simulated-state",
        capabilities: {
          sandboxSimulation: true,
          resourceGraph: true,
          structuredDiff: true,
          untrustedContext: true,
          durableDecision: true,
        },
        runtimeMode: "self-hosted",
        source: "uploaded-offline-artifact",
        analysisMode: "offline",
        provenance: "uploaded-offline-artifact",
      },
      intake: {
        domainId: "network",
        source: {
          domainId: "network",
          sourceId: "network-source",
          sourceKind: "network-incident-bundle",
          origin: "uploaded-offline-artifact",
          untrustedArtifactObservedAtUtc: "2026-07-30T11:59:00.000Z",
        },
        input: {
          inputId: "network-input",
          inputSha256: "a".repeat(64),
          content: {},
        },
      },
      storage: { kind: "append-only-review-store" },
    },
  };
}

function attempt(
  token: number,
  reviewId: string,
  kind: ReviewAttempt["kind"] = "select",
): ReviewAttempt {
  return { token, reviewId, kind };
}

describe("self-hosted review view state", () => {
  it("ignores a stale selection completion unless review id and attempt token match", () => {
    const first = attempt(1, "review-one");
    const second = attempt(2, "review-two");
    let state = selfHostedReviewViewReducer(
      INITIAL_SELF_HOSTED_REVIEW_VIEW_STATE,
      { type: "begin", attempt: first },
    );
    state = selfHostedReviewViewReducer(state, {
      type: "begin",
      attempt: second,
    });
    const beforeStaleCompletion = state;
    state = selfHostedReviewViewReducer(state, {
      type: "selected",
      attempt: first,
      review: review("review-one"),
      resolutionStatus: "pending",
      proof: { status: "not-created" },
    });
    expect(state).toBe(beforeStaleCompletion);

    state = selfHostedReviewViewReducer(state, {
      type: "selected",
      attempt: second,
      review: review("review-two"),
      resolutionStatus: "pending",
      proof: { status: "not-created" },
    });
    expect(state.review?.reviewId).toBe("review-two");
    expect(state.targetReviewId).toBe("review-two");
  });

  it("cannot overwrite a newer queue selection with a stale decision completion", () => {
    const selectFirst = attempt(1, "review-one");
    const decideFirst = attempt(2, "review-one", "decide");
    const selectSecond = attempt(3, "review-two");
    let state = selfHostedReviewViewReducer(
      INITIAL_SELF_HOSTED_REVIEW_VIEW_STATE,
      { type: "begin", attempt: selectFirst },
    );
    state = selfHostedReviewViewReducer(state, {
      type: "selected",
      attempt: selectFirst,
      review: review("review-one"),
      resolutionStatus: "pending",
      proof: { status: "not-created" },
    });
    state = selfHostedReviewViewReducer(state, {
      type: "finish",
      attempt: selectFirst,
    });
    state = selfHostedReviewViewReducer(state, {
      type: "begin",
      attempt: decideFirst,
    });
    state = selfHostedReviewViewReducer(state, {
      type: "begin",
      attempt: selectSecond,
    });
    state = selfHostedReviewViewReducer(state, {
      type: "decision-resolved",
      attempt: decideFirst,
    });

    expect(state.targetReviewId).toBe("review-two");
    expect(state.review).toBeNull();
    expect(state.resolutionStatus).toBe("unknown");
  });

  it("keeps a successful decision resolved when receipt proof is unavailable", () => {
    const select = attempt(1, "review-one");
    const decide = attempt(2, "review-one", "decide");
    let state = selfHostedReviewViewReducer(
      INITIAL_SELF_HOSTED_REVIEW_VIEW_STATE,
      { type: "begin", attempt: select },
    );
    state = selfHostedReviewViewReducer(state, {
      type: "selected",
      attempt: select,
      review: review("review-one"),
      resolutionStatus: "pending",
      proof: { status: "not-created" },
    });
    state = selfHostedReviewViewReducer(state, { type: "finish", attempt: select });
    state = selfHostedReviewViewReducer(state, { type: "begin", attempt: decide });
    state = selfHostedReviewViewReducer(state, {
      type: "decision-resolved",
      attempt: decide,
    });
    state = selfHostedReviewViewReducer(state, {
      type: "proof-completed",
      attempt: decide,
      proof: { status: "unavailable" },
      message: "proof unavailable",
    });

    expect(state.resolutionStatus).toBe("resolved");
    expect(state.proof.status).toBe("unavailable");
    expect(state.message).toBe("proof unavailable");
  });

  it("fails closed when selection proof cannot establish pending or resolved state", () => {
    const select = attempt(1, "review-one");
    let state = selfHostedReviewViewReducer(
      INITIAL_SELF_HOSTED_REVIEW_VIEW_STATE,
      { type: "begin", attempt: select },
    );
    state = selfHostedReviewViewReducer(state, {
      type: "selected",
      attempt: select,
      review: review("review-one"),
      resolutionStatus: "unknown",
      proof: { status: "unavailable" },
    });

    expect(state.resolutionStatus).toBe("unknown");
    expect(state.proof.status).toBe("unavailable");
  });
});
