import { describe, expect, it } from "vitest";
import { IllegalTransitionError } from "@changesafe/core";

import {
  REVIEW_CONTRACT_VERSION,
  type ReviewEffectCapability,
  type ReviewSessionEnvelope,
} from "@/features/domains/review-contract";
import {
  approveReview,
  completeReviewSimulation,
  initialReviewControllerState,
  receiveReviewTransport,
  reviewCanSimulate,
  reviewControllerReducer,
  startReview,
} from "@/features/reviews/controller";

const input = {
  incidentId: "incident-one",
  alert: "Link instability",
};

const networkSession: ReviewSessionEnvelope = {
  domainId: "network",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "simulated-state",
  capabilities: {
    sandboxSimulation: true,
    resourceGraph: true,
    structuredDiff: true,
    untrustedContext: true,
    durableDecision: false,
  },
  runtimeMode: "public-replay",
  source: "bundled-replay",
  analysisMode: "replay",
  provenance: "captured-replay",
};

const terraformSession: ReviewSessionEnvelope = {
  domainId: "terraform",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "external-diff",
  capabilities: {
    sandboxSimulation: false,
    resourceGraph: false,
    structuredDiff: true,
    untrustedContext: true,
    durableDecision: true,
  },
  runtimeMode: "self-hosted",
  source: "uploaded-offline-artifact",
  analysisMode: "offline",
  provenance: "uploaded-offline-artifact",
};

const proposal = {
  proposalId: "proposal-one",
  summary: "Replace one declarative value.",
  diagnosis: {
    likelyCause: "A stale value was detected.",
    confidence: 0.8,
    evidenceIds: ["ev-alert-001"],
    assumptions: [],
  },
  operations: [
    {
      op: "replace",
      path: "/resources/resource-one",
      value: { enabled: true },
      reason: "Restore the intended state.",
      evidenceIds: ["ev-alert-001"],
    },
  ],
  rollbackOperations: [
    {
      op: "replace",
      path: "/resources/resource-one",
      value: { enabled: false },
      reason: "Restore the prior state.",
      evidenceIds: ["ev-alert-001"],
    },
  ],
  verificationSteps: [],
};

const simulation = {
  status: "completed",
  changedResourceIds: ["resource:resource-one"],
  diff: [
    {
      op: "replace",
      path: "/resources/resource-one",
      before: { enabled: false },
      after: { enabled: true },
    },
  ],
  safetyProperties: [
    {
      propertyId: "resource-remains-available",
      satisfied: true,
      detail: "The modeled resource remains available.",
    },
  ],
  summary: "One declarative operation was applied to a sandboxed clone.",
} as const;

function buildAnalysis(
  session: ReviewSessionEnvelope,
  status: "PASS" | "BLOCK",
  effectCapability: ReviewEffectCapability,
) {
  return {
    ok: true,
    contractVersion: REVIEW_CONTRACT_VERSION,
    domainId: session.domainId,
    session,
    sourceId: "scenario-one",
    inputId: input.incidentId,
    input,
    proposal,
    findings: [
      {
        policyId: "PATCH_SCHEMA",
        status,
        title: status === "PASS" ? "Patch is valid" : "Patch is blocked",
        explanation:
          status === "PASS"
            ? "The declarative operation has a supported shape."
            : "The declarative operation cannot be proven safe.",
        affectedResources: ["resource:resource-one"],
        remediation: status === "PASS" ? null : "Revise the proposal.",
      },
    ],
    riskLevel: status === "PASS" ? "LOW" : "CRITICAL",
    provenance:
      session.provenance === "captured-replay"
        ? {
            classification: "captured-replay",
            model: "gpt-5.6",
            provider: null,
            fixtureId: "fixture-one",
            notes: "Captured output replayed without a live request.",
          }
        : {
            classification: "uploaded-offline-artifact",
            model: null,
            provider: null,
            fixtureId: null,
            notes: null,
          },
    effectCapability,
  };
}

function analyzing(session: ReviewSessionEnvelope = networkSession) {
  const ready = initialReviewControllerState({
    sourceId: "scenario-one",
    input,
    session,
  });
  return reviewControllerReducer(ready, startReview());
}

describe("pure review controller", () => {
  it("drives safe findings through core CLASSIFY to APPROVAL_REQUIRED", () => {
    const state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(state.workflow.phase).toBe("APPROVAL_REQUIRED");
  });

  it("drives BLOCK findings through core CLASSIFY to BLOCKED", () => {
    const state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        buildAnalysis(networkSession, "BLOCK", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(state.workflow.phase).toBe("BLOCKED");
    expect(reviewCanSimulate(state)).toBe(false);
  });

  it("lets core reject illegal approval of a blocked review", () => {
    const blocked = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        buildAnalysis(networkSession, "BLOCK", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(() => reviewControllerReducer(blocked, approveReview())).toThrow(
      IllegalTransitionError,
    );
  });

  it.each([
    [
      "malformed",
      {
        ...buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation" as const,
        }),
        findings: undefined,
      },
    ],
    [
      "contract-mismatched",
      {
        ...buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation" as const,
        }),
        contractVersion: "2.0.0",
      },
    ],
    [
      "source-mismatched",
      {
        ...buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation" as const,
        }),
        sourceId: "scenario-other",
      },
    ],
  ])("drops a partial proposal from %s transport into a safe error", (_label, payload) => {
    const state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(payload),
    );

    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Review analysis could not be loaded safely.",
    });
    expect("proposal" in state.workflow).toBe(false);
    expect(state.review).toBeNull();
  });

  it("completes real sandbox simulation only for simulated-state reviews", () => {
    let state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
      ),
    );
    expect(reviewCanSimulate(state)).toBe(false);

    state = reviewControllerReducer(state, approveReview());
    expect(reviewCanSimulate(state)).toBe(true);
    state = reviewControllerReducer(
      state,
      completeReviewSimulation(simulation),
    );

    expect(state.workflow.phase).toBe("SIMULATED");
  });

  it("never fabricates simulation for an external-diff review", () => {
    let state = reviewControllerReducer(
      analyzing(terraformSession),
      receiveReviewTransport(
        buildAnalysis(terraformSession, "PASS", {
          kind: "external-diff",
        }),
      ),
    );
    expect(reviewCanSimulate(state)).toBe(false);

    state = reviewControllerReducer(state, approveReview());
    expect(state.workflow.phase).toBe("APPROVED");
    expect(() =>
      reviewControllerReducer(state, completeReviewSimulation(simulation)),
    ).toThrow(/external-diff/i);
    expect(state.workflow.phase).toBe("APPROVED");
  });
});
