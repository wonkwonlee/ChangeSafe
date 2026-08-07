import { describe, expect, it } from "vitest";

import {
  evaluatePolicies,
  verifyReceiptHash,
} from "@changesafe/core";
import {
  NETWORK_POLICY_VERSION,
  POLICY_VERSION,
  networkDomain,
  runSimulation,
  type IncidentBundle,
} from "@changesafe/domain-network";

import { createNetworkReviewReceipt } from "@/features/domains/network/receipt";
import {
  REVIEW_CONTRACT_VERSION,
  type ReviewAnalysisResult,
  type ReviewProvenance,
  type ReviewSessionEnvelope,
} from "@/features/domains/review-contract";
import {
  approveReview,
  completeReviewSimulation,
  initialReviewControllerState,
  receiveReviewTransport,
  rejectReview,
  reviewControllerReducer,
  startReview,
  type ReviewControllerState,
} from "@/features/reviews/controller";
import { NETWORK_SCENARIOS } from "@/scenarios";

const APP_VERSION = "0.5.0";
const CREATED_AT = "2026-07-29T00:00:00.000Z";

function scenarioOrThrow(scenarioId: string) {
  const scenario = NETWORK_SCENARIOS.find((candidate) => candidate.scenarioId === scenarioId);
  if (!scenario) throw new Error(`missing ${scenarioId}`);
  return scenario;
}

function reviewOrigin(provenance: "captured" | "authored_synthetic" | "authored_red_team") {
  switch (provenance) {
    case "captured":
      return ["bundled-replay", "captured-replay"] as const;
    case "authored_synthetic":
      return ["authored-fixture", "authored-synthetic"] as const;
    case "authored_red_team":
      return ["authored-fixture", "authored-red-team"] as const;
  }
}

function sessionFor(
  scenarioId: string,
  provenance: "captured" | "authored_synthetic" | "authored_red_team",
): ReviewSessionEnvelope {
  const [source, classification] = reviewOrigin(provenance);
  return {
    domainId: "network",
    contractVersion: REVIEW_CONTRACT_VERSION,
    policyVersion: POLICY_VERSION,
    domainShape: "simulated-state",
    capabilities: {
      sandboxSimulation: true,
      resourceGraph: true,
      structuredDiff: true,
      untrustedContext: true,
      durableDecision: true,
    },
    runtimeMode: "self-hosted",
    source,
    analysisMode: "replay",
    provenance: classification,
  };
}

function activeReview(
  scenarioId: string,
): ReviewControllerState<IncidentBundle> {
  const scenario = scenarioOrThrow(scenarioId);
  const session = sessionFor(scenarioId, scenario.fixture.provenance);
  let state = initialReviewControllerState({
    sourceId: scenario.scenarioId,
    expectedInputId: scenario.inputId,
    input: scenario.input as IncidentBundle,
    session,
  });
  state = reviewControllerReducer(state, startReview("attempt-network-receipt"));
  state = reviewControllerReducer(
    state,
    receiveReviewTransport(
      "attempt-network-receipt",
      analysisFor(
        scenario.scenarioId,
        scenario.input as IncidentBundle,
        scenario.fixture.proposal,
        session,
        scenario.fixture,
      ),
    ),
  );
  return state;
}

function analysisFor(
  sourceId: string,
  input: IncidentBundle,
  proposal: ReviewAnalysisResult["proposal"],
  session: ReviewSessionEnvelope,
  fixture: ReturnType<typeof scenarioOrThrow>["fixture"],
): ReviewAnalysisResult {
  const evaluation = evaluatePolicies(networkDomain, input, proposal);
  const provenance = session.provenance as ReviewProvenance;
  return {
    ok: true,
    contractVersion: REVIEW_CONTRACT_VERSION,
    domainId: "network",
    session,
    sourceId,
    inputId: input.incidentId,
    input,
    proposal,
    findings: evaluation.findings,
    riskLevel: evaluation.riskLevel,
    provenance: {
      classification: provenance,
      model: fixture.model,
      provider: null,
      fixtureId: fixture.fixtureId,
      notes: fixture.notes,
    },
    effectCapability: { kind: "sandbox-simulation" },
  };
}

function completeApprovedReview(): ReviewControllerState<IncidentBundle> {
  const reviewed = activeReview("scenario-a-failover");
  const approved = reviewControllerReducer(reviewed, approveReview());
  if (approved.workflow.phase !== "APPROVED") {
    throw new Error("safe Network fixture must require approval");
  }
  return reviewControllerReducer(
    approved,
    completeReviewSimulation(runSimulation(approved.workflow.input, approved.workflow.proposal)),
  );
}

describe("Network review receipt composition", () => {
  it("propagates the exact Network policy version through a safe simulated receipt", async () => {
    const state = completeApprovedReview();
    const receipt = await createNetworkReviewReceipt(state, {
      appVersion: APP_VERSION,
      createdAtUtc: CREATED_AT,
      receiptId: "rcpt-network-safe",
    });

    expect(receipt).toMatchObject({
      policyVersion: POLICY_VERSION,
      decision: "approved",
      fixtureProvenance: "captured",
      simulation: state.workflow.phase === "SIMULATED" ? state.workflow.simulation : null,
    });
    expect(POLICY_VERSION).toContain(NETWORK_POLICY_VERSION);
    expect(await verifyReceiptHash(receipt)).toBe(true);
  });

  it("records a rejection without a simulation", async () => {
    const reviewed = activeReview("scenario-a-failover");
    const rejected = reviewControllerReducer(reviewed, rejectReview());
    const receipt = await createNetworkReviewReceipt(rejected, {
      appVersion: APP_VERSION,
      createdAtUtc: CREATED_AT,
      receiptId: "rcpt-network-rejected",
    });

    expect(receipt).toMatchObject({ decision: "rejected", simulation: null });
  });

  it("records a blocked red-team result without a simulation", async () => {
    const blocked = activeReview("scenario-h-alert-injection");
    expect(blocked.workflow.phase).toBe("BLOCKED");
    const receipt = await createNetworkReviewReceipt(blocked, {
      appVersion: APP_VERSION,
      createdAtUtc: CREATED_AT,
      receiptId: "rcpt-network-blocked",
    });

    expect(receipt).toMatchObject({
      decision: "blocked",
      fixtureProvenance: "authored_red_team",
      simulation: null,
    });
  });

  it("rejects receipt creation outside a completed decision state", async () => {
    const reviewed = activeReview("scenario-a-failover");
    await expect(
      createNetworkReviewReceipt(reviewed, { appVersion: APP_VERSION }),
    ).rejects.toThrow("completed decision state");
  });
});
