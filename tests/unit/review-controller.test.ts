import { describe, expect, it } from "vitest";
import {
  ChangeReceiptSchema,
  createReceipt,
  hashCanonical,
  IllegalTransitionError,
  type Approver,
  type ChangeReceipt,
  type SimulationResult,
} from "@changesafe/core";

import {
  REVIEW_CONTRACT_VERSION,
  type ReviewEffectCapability,
  type ReviewSessionEnvelope,
} from "@/features/domains/review-contract";
import { buildReceipt } from "@/tests/helpers/fixtures";
import {
  approveReview,
  completeReviewSimulation,
  initialReviewControllerState,
  rebindReview,
  receiveReviewTransport,
  recordReviewReceipt,
  rejectReview,
  reviewControllerReducer,
  startReview,
  type ReviewControllerState,
} from "@/features/reviews/controller";

const input = {
  incidentId: "incident-one",
  alert: "Link instability",
};

const FIRST_ATTEMPT_ID = "attempt-one";
const SECOND_ATTEMPT_ID = "attempt-two";

const networkSession: ReviewSessionEnvelope = {
  domainId: "network",
  contractVersion: REVIEW_CONTRACT_VERSION,
  policyVersion: "test-network-v1",
  domainShape: "simulated-state",
  capabilities: {
    sandboxSimulation: true,
    resourceGraph: true,
    structuredDiff: true,
    untrustedContext: true,
    durableDecision: true,
  },
  runtimeMode: "self-hosted",
  source: "bundled-replay",
  analysisMode: "replay",
  provenance: "captured-replay",
};

const publicReplayNetworkSession: ReviewSessionEnvelope = {
  ...networkSession,
  capabilities: {
    ...networkSession.capabilities,
    durableDecision: false,
  },
  runtimeMode: "public-replay",
};

const terraformSession: ReviewSessionEnvelope = {
  domainId: "terraform",
  contractVersion: REVIEW_CONTRACT_VERSION,
  policyVersion: "test-terraform-v1",
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

const liveNetworkSession: ReviewSessionEnvelope = {
  ...networkSession,
  source: "live-model",
  analysisMode: "live",
  provenance: "live-model",
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

const simulation: SimulationResult = {
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
};

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

function analyzing(
  session: ReviewSessionEnvelope = networkSession,
  attemptId = FIRST_ATTEMPT_ID,
) {
  return reviewControllerReducer(
    readyState(session),
    startReview(attemptId),
  );
}

function readyState(session: ReviewSessionEnvelope = networkSession) {
  return initialReviewControllerState({
    sourceId: "scenario-one",
    input,
    expectedInputId: input.incidentId,
    session,
  });
}

function decisionState(status: "PASS" | "BLOCK") {
  return reviewControllerReducer(
    analyzing(),
    receiveReviewTransport(
      FIRST_ATTEMPT_ID,
      buildAnalysis(networkSession, status, {
        kind: "sandbox-simulation",
      }),
    ),
  );
}

function approvedState() {
  return reviewControllerReducer(decisionState("PASS"), approveReview());
}

function rejectedState() {
  return reviewControllerReducer(decisionState("PASS"), rejectReview());
}

function simulatedState() {
  return reviewControllerReducer(
    approvedState(),
    completeReviewSimulation(simulation),
  );
}

async function buildBoundReceipt(
  state: ReviewControllerState<typeof input>,
  approver: Approver | null = null,
): Promise<ChangeReceipt> {
  const { workflow } = state;
  if (
    workflow.phase !== "BLOCKED" &&
    workflow.phase !== "REJECTED" &&
    workflow.phase !== "SIMULATED"
  ) {
    throw new Error(`cannot build a bound receipt from ${workflow.phase}`);
  }
  const decision =
    workflow.phase === "BLOCKED"
      ? "blocked"
      : workflow.phase === "REJECTED"
        ? "rejected"
        : "approved";
  return createReceipt({
    sourceId: workflow.sourceId,
    inputId: state.expectedInputId,
    input: workflow.input,
    proposal: workflow.proposal,
    appVersion: "test",
    policyVersion: state.session.policyVersion,
    mode: workflow.mode,
    model: state.review?.provenance.model ?? null,
    fixtureProvenance: workflow.provenance,
    findings: workflow.findings,
    riskLevel: workflow.riskLevel,
    decision,
    approver,
    simulation: workflow.phase === "SIMULATED" ? workflow.simulation : null,
    receiptId: `receipt-${decision}`,
    createdAtUtc: "2026-07-29T12:00:00Z",
  });
}

async function rehashReceipt(
  receipt: ChangeReceipt,
  overrides: Partial<ChangeReceipt>,
): Promise<ChangeReceipt> {
  const { receiptSha256, ...unhashed } = {
    ...receipt,
    ...overrides,
  };
  void receiptSha256;
  return ChangeReceiptSchema.parse({
    ...unhashed,
    receiptSha256: await hashCanonical(unhashed),
  });
}

describe("pure review controller", () => {
  it("validates review correlation identifiers at reducer boundaries", () => {
    const ready = initialReviewControllerState({
      sourceId: "scenario-one",
      input,
      expectedInputId: input.incidentId,
      session: networkSession,
    });

    expect(() =>
      reviewControllerReducer(ready, startReview("INVALID")),
    ).toThrow();
    expect(() =>
      initialReviewControllerState({
        sourceId: "scenario-one",
        input,
        expectedInputId: "INVALID",
        session: networkSession,
      }),
    ).toThrow();
    expect(() =>
      reviewControllerReducer(
        analyzing(),
        receiveReviewTransport(
          "INVALID",
          buildAnalysis(networkSession, "PASS", {
            kind: "sandbox-simulation",
          }),
        ),
      ),
    ).toThrow();
  });

  it("drives safe findings through core CLASSIFY to APPROVAL_REQUIRED", () => {
    const state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        FIRST_ATTEMPT_ID,
        buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(state.workflow.phase).toBe("APPROVAL_REQUIRED");
    expect(state.activeRequest).toBeNull();
  });

  it("drives BLOCK findings through core CLASSIFY to BLOCKED", () => {
    const state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        FIRST_ATTEMPT_ID,
        buildAnalysis(networkSession, "BLOCK", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(state.workflow.phase).toBe("BLOCKED");
  });

  it("retains a validated transport error and its replay metadata", () => {
    const state = reviewControllerReducer(
      analyzing(liveNetworkSession),
      receiveReviewTransport(FIRST_ATTEMPT_ID, {
        ok: false,
        contractVersion: REVIEW_CONTRACT_VERSION,
        error: {
          code: "ANALYSIS_UNAVAILABLE",
          message: "Live analysis is unavailable. Replay remains available.",
          domainId: "network",
          replayAvailable: true,
          replaySource: {
            domainId: "network",
            contractVersion: REVIEW_CONTRACT_VERSION,
            sourceId: "scenario-one",
          },
          expectedContractVersion: null,
          receivedContractVersion: null,
        },
      }),
    );

    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Live analysis is unavailable. Replay remains available.",
    });
    expect(state.transportError).toMatchObject({
      code: "ANALYSIS_UNAVAILABLE",
      replayAvailable: true,
      replaySource: {
        sourceId: "scenario-one",
      },
    });
    expect(state.review).toBeNull();
    expect(state.activeRequest).toBeNull();
  });

  it("uses the generic safe error for malformed transport errors", () => {
    const state = reviewControllerReducer(
      analyzing(liveNetworkSession),
      receiveReviewTransport(FIRST_ATTEMPT_ID, {
        ok: false,
        contractVersion: REVIEW_CONTRACT_VERSION,
        error: {
          code: "ANALYSIS_UNAVAILABLE",
          message: "Unvalidated message",
          domainId: "network",
          replayAvailable: true,
        },
      }),
    );

    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Review analysis could not be loaded safely.",
    });
    expect(state.transportError).toBeNull();
  });

  it("atomically rebinds source identity and ignores the prior request", () => {
    const previous = analyzing(networkSession, FIRST_ATTEMPT_ID);
    const replacementInput = {
      incidentId: "incident-two",
      alert: "Route instability",
    };
    const rebound = reviewControllerReducer(
      previous,
      rebindReview({
        sourceId: "scenario-two",
        input: replacementInput,
        expectedInputId: replacementInput.incidentId,
        session: networkSession,
      }),
    );

    expect(rebound).toMatchObject({
      session: networkSession,
      expectedInputId: "incident-two",
      workflow: {
        phase: "READY",
        sourceId: "scenario-two",
        input: replacementInput,
      },
      review: null,
      transportError: null,
      activeRequest: null,
    });
    expect(
      reviewControllerReducer(
        rebound,
        receiveReviewTransport(
          FIRST_ATTEMPT_ID,
          buildAnalysis(networkSession, "PASS", {
            kind: "sandbox-simulation",
          }),
        ),
      ),
    ).toBe(rebound);
  });

  it.each([
    ["READY", readyState],
    ["ANALYZING", () => analyzing()],
    [
      "ERROR",
      () =>
        reviewControllerReducer(
          analyzing(),
          receiveReviewTransport(FIRST_ATTEMPT_ID, { malformed: true }),
        ),
    ],
    ["APPROVAL_REQUIRED", () => decisionState("PASS")],
    ["BLOCKED", () => decisionState("BLOCK")],
    ["REJECTED", rejectedState],
    ["APPROVED", approvedState],
    ["SIMULATED", simulatedState],
    [
      "RECEIPT_ISSUED",
      async () => {
        const blocked = decisionState("BLOCK");
        return reviewControllerReducer(
          blocked,
          await recordReviewReceipt(
            blocked,
            await buildBoundReceipt(blocked),
          ),
        );
      },
    ],
  ] as const)("rebinds %s through core RESET", async (_phase, buildState) => {
    const replacementInput = {
      incidentId: "incident-two",
      alert: "Route instability",
    };
    const state = reviewControllerReducer(
      await buildState(),
      rebindReview({
        sourceId: "scenario-two",
        input: replacementInput,
        expectedInputId: replacementInput.incidentId,
        session: networkSession,
      }),
    );

    expect(state.workflow).toEqual({
      phase: "READY",
      sourceId: "scenario-two",
      input: replacementInput,
    });
  });

  it("lets core reject illegal approval of a blocked review", () => {
    const blocked = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        FIRST_ATTEMPT_ID,
        buildAnalysis(networkSession, "BLOCK", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(() => reviewControllerReducer(blocked, approveReview())).toThrow(
      IllegalTransitionError,
    );
  });

  it("delegates rejection to the core workflow", () => {
    const state = reviewControllerReducer(
      decisionState("PASS"),
      rejectReview(),
    );

    expect(state.workflow.phase).toBe("REJECTED");
  });

  it("keeps public replay evidence-only across every durable controller command", async () => {
    let state = reviewControllerReducer(
      analyzing(publicReplayNetworkSession),
      receiveReviewTransport(
        FIRST_ATTEMPT_ID,
        buildAnalysis(publicReplayNetworkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(state.workflow.phase).toBe("APPROVAL_REQUIRED");
    const reviewed = state;
    state = reviewControllerReducer(state, approveReview());
    expect(state).toBe(reviewed);
    state = reviewControllerReducer(state, rejectReview());
    expect(state).toBe(reviewed);
    state = reviewControllerReducer(
      state,
      completeReviewSimulation(simulation),
    );
    expect(state).toBe(reviewed);

    await expect(
      recordReviewReceipt(
        state,
        buildReceipt({ decision: "rejected" }),
      ),
    ).rejects.toThrow(/public replay.*receipt/i);
  });

  it.each([
    ["BLOCKED", () => decisionState("BLOCK")],
    ["REJECTED", rejectedState],
    ["SIMULATED", simulatedState],
  ] as const)("records a bound receipt from %s", async (_phase, buildState) => {
    const beforeReceipt = buildState();
    const receipt = await buildBoundReceipt(beforeReceipt);
    const state = reviewControllerReducer(
      beforeReceipt,
      await recordReviewReceipt(beforeReceipt, receipt),
    );

    expect(state.workflow.phase).toBe("RECEIPT_ISSUED");
    if (state.workflow.phase === "RECEIPT_ISSUED") {
      expect(state.workflow.receipt).toEqual(receipt);
    }
  });

  describe("authenticated approver binding", () => {
    const sessionApprover: Approver = {
      subject: "sub-self-hosted-approver",
      issuer: "https://issuer.example.test",
      email: "approver@example.test",
    };

    function blockedStateFor(approver: Approver | null) {
      return reviewControllerReducer(
        reviewControllerReducer(
          initialReviewControllerState({
            sourceId: "scenario-one",
            input,
            expectedInputId: input.incidentId,
            session: networkSession,
            approver,
          }),
          startReview(FIRST_ATTEMPT_ID),
        ),
        receiveReviewTransport(
          FIRST_ATTEMPT_ID,
          buildAnalysis(networkSession, "BLOCK", {
            kind: "sandbox-simulation",
          }),
        ),
      );
    }

    it("records a signed server receipt that names the session's approver", async () => {
      const blocked = blockedStateFor(sessionApprover);
      const receipt = await buildBoundReceipt(blocked, sessionApprover);
      expect(receipt.approver).toEqual(sessionApprover);

      const state = reviewControllerReducer(
        blocked,
        await recordReviewReceipt(blocked, receipt),
      );

      expect(state.workflow.phase).toBe("RECEIPT_ISSUED");
    });

    it.each([
      [
        "a different authenticated identity",
        { ...sessionApprover, subject: "sub-somebody-else" },
      ],
      ["no approver at all", null],
    ] as const)("refuses a receipt naming %s", async (_label, approver) => {
      const blocked = blockedStateFor(sessionApprover);
      const receipt = await buildBoundReceipt(blocked, approver);

      const state = reviewControllerReducer(
        blocked,
        await recordReviewReceipt(blocked, receipt),
      );

      expect(state.workflow).toMatchObject({
        phase: "ERROR",
        userMessage: "Review receipt could not be verified safely.",
      });
    });

    it("refuses an approver-bearing receipt when no identity was established", async () => {
      const blocked = blockedStateFor(null);
      const receipt = await buildBoundReceipt(blocked, sessionApprover);

      const state = reviewControllerReducer(
        blocked,
        await recordReviewReceipt(blocked, receipt),
      );

      expect(state.workflow).toMatchObject({ phase: "ERROR" });
    });
  });

  it.each([
    ["READY", readyState],
    ["APPROVAL_REQUIRED", () => decisionState("PASS")],
    ["APPROVED", approvedState],
  ] as const)("rejects receipt preparation from %s", async (_phase, buildState) => {
    await expect(
      recordReviewReceipt(
        buildState(),
        buildReceipt({ decision: "blocked" }),
      ),
    ).rejects.toThrow(IllegalTransitionError);
  });

  it("fails safely instead of installing a malformed receipt", async () => {
    const blocked = decisionState("BLOCK");
    const receipt = await buildBoundReceipt(blocked);
    const state = reviewControllerReducer(
      blocked,
      await recordReviewReceipt(blocked, {
        ...receipt,
        findings: undefined,
      }),
    );

    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Review receipt could not be verified safely.",
    });
    expect("receipt" in state.workflow).toBe(false);
    expect(state.review).toBeNull();
  });

  it.each([
    ["source", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { sourceId: "scenario-other" })],
    ["input id", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { inputId: "incident-other" })],
    ["input hash", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { inputSha256: "a".repeat(64) })],
    ["proposal id", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { proposalId: "proposal-other" })],
    ["proposal hash", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { proposalSha256: "b".repeat(64) })],
    ["findings", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, {
        findings: receipt.findings.map((finding, index) =>
          index === 0 ? { ...finding, title: "Altered finding" } : finding,
        ),
      })],
    ["risk", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { riskLevel: "MEDIUM" })],
    ["policy version", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { policyVersion: "test-network-v2" })],
    ["mode", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { mode: "offline" })],
    ["provenance", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { fixtureProvenance: "authored_synthetic" })],
    ["model", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, { model: "gpt-5.5" })],
    ["simulation", async (receipt: ChangeReceipt) =>
      rehashReceipt(receipt, {
        simulation: receipt.simulation
          ? { ...receipt.simulation, summary: "Altered simulation" }
          : null,
      })],
    ["receipt hash", async (receipt: ChangeReceipt) => ({
      ...receipt,
      receiptSha256: "c".repeat(64),
    })],
  ] as const)(
    "fails an approved receipt with a schema-valid %s mismatch",
    async (_field, mutate) => {
      const simulated = simulatedState();
      const receipt = await mutate(await buildBoundReceipt(simulated));
      const state = reviewControllerReducer(
        simulated,
        await recordReviewReceipt(simulated, receipt),
      );

      expect(state.workflow).toMatchObject({
        phase: "ERROR",
        userMessage: "Review receipt could not be verified safely.",
      });
      expect("receipt" in state.workflow).toBe(false);
      expect(state.review).toBeNull();
    },
  );

  it("fails a public replay receipt with a forged approver", async () => {
    const simulated = simulatedState();
    const receipt = await rehashReceipt(
      await buildBoundReceipt(simulated),
      {
        approver: {
          subject: "forged-user",
          issuer: "https://identity.example",
          email: "forged@example.com",
        },
      },
    );
    const state = reviewControllerReducer(
      simulated,
      await recordReviewReceipt(simulated, receipt),
    );

    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Review receipt could not be verified safely.",
    });
    expect("receipt" in state.workflow).toBe(false);
    expect(state.review).toBeNull();
  });

  it("fails a blocked receipt whose decision was rebound to rejection", async () => {
    const blocked = decisionState("BLOCK");
    const receipt = await rehashReceipt(
      await buildBoundReceipt(blocked),
      { decision: "rejected" },
    );
    const state = reviewControllerReducer(
      blocked,
      await recordReviewReceipt(blocked, receipt),
    );

    expect(state.workflow.phase).toBe("ERROR");
    expect("receipt" in state.workflow).toBe(false);
  });

  it("ignores a verified receipt command after the active workflow is rebound", async () => {
    const blocked = decisionState("BLOCK");
    const command = await recordReviewReceipt(
      blocked,
      await buildBoundReceipt(blocked),
    );
    const replacementInput = {
      incidentId: "incident-two",
      alert: "Route instability",
    };
    const rebound = reviewControllerReducer(
      blocked,
      rebindReview({
        sourceId: "scenario-two",
        input: replacementInput,
        expectedInputId: replacementInput.incidentId,
        session: networkSession,
      }),
    );

    expect(reviewControllerReducer(rebound, command)).toBe(rebound);
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
        contractVersion: "1.0.0",
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
      receiveReviewTransport(FIRST_ATTEMPT_ID, payload),
    );

    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Review analysis could not be loaded safely.",
    });
    expect("proposal" in state.workflow).toBe(false);
    expect(state.review).toBeNull();
    expect(state.activeRequest).toBeNull();
  });

  it("fails safely when transport input identity does not match the active request", () => {
    const state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(FIRST_ATTEMPT_ID, {
        ...buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
        inputId: "incident-other",
      }),
    );

    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Review analysis could not be loaded safely.",
    });
    expect("proposal" in state.workflow).toBe(false);
    expect(state.review).toBeNull();
    expect(state.activeRequest).toBeNull();
  });

  it("ignores a stale same-source result after a retry", () => {
    let state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(FIRST_ATTEMPT_ID, {
        ...buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
        findings: undefined,
      }),
    );
    state = reviewControllerReducer(
      state,
      startReview(SECOND_ATTEMPT_ID),
    );
    const retrying = state;

    state = reviewControllerReducer(
      state,
      receiveReviewTransport(
        FIRST_ATTEMPT_ID,
        buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(state).toBe(retrying);
    expect(state.workflow.phase).toBe("ANALYZING");
    expect(state.activeRequest).toEqual({
      attemptId: SECOND_ATTEMPT_ID,
    });

    state = reviewControllerReducer(
      state,
      receiveReviewTransport(
        SECOND_ATTEMPT_ID,
        buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    expect(state.workflow.phase).toBe("APPROVAL_REQUIRED");
    expect(state.activeRequest).toBeNull();
  });

  it("does not let a retry replace the initialized input identity", () => {
    let state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(FIRST_ATTEMPT_ID, {
        ...buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
        findings: undefined,
      }),
    );
    state = reviewControllerReducer(
      state,
      Reflect.apply(startReview, undefined, [
        SECOND_ATTEMPT_ID,
        "incident-other",
      ]),
    );
    state = reviewControllerReducer(
      state,
      receiveReviewTransport(SECOND_ATTEMPT_ID, {
        ...buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
        inputId: "incident-other",
      }),
    );

    expect(state.expectedInputId).toBe(input.incidentId);
    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Review analysis could not be loaded safely.",
    });
    expect("proposal" in state.workflow).toBe(false);
    expect(state.review).toBeNull();
    expect(state.activeRequest).toBeNull();
  });

  it("completes real sandbox simulation only for simulated-state reviews", () => {
    let state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        FIRST_ATTEMPT_ID,
        buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
      ),
    );

    state = reviewControllerReducer(state, approveReview());
    state = reviewControllerReducer(
      state,
      completeReviewSimulation(simulation),
    );

    expect(state.workflow.phase).toBe("SIMULATED");
  });

  it("routes malformed simulation through core error cleanup", () => {
    let state = reviewControllerReducer(
      analyzing(),
      receiveReviewTransport(
        FIRST_ATTEMPT_ID,
        buildAnalysis(networkSession, "PASS", {
          kind: "sandbox-simulation",
        }),
      ),
    );
    state = reviewControllerReducer(state, approveReview());
    state = reviewControllerReducer(
      state,
      completeReviewSimulation({ status: "completed" }),
    );

    expect(state.workflow).toMatchObject({
      phase: "ERROR",
      userMessage: "Review analysis could not be loaded safely.",
    });
    expect("proposal" in state.workflow).toBe(false);
    expect(state.review).toBeNull();
    expect(state.activeRequest).toBeNull();
  });

  it("never fabricates simulation for an external-diff review", () => {
    let state = reviewControllerReducer(
      analyzing(terraformSession),
      receiveReviewTransport(
        FIRST_ATTEMPT_ID,
        buildAnalysis(terraformSession, "PASS", {
          kind: "external-diff",
        }),
      ),
    );

    state = reviewControllerReducer(state, approveReview());
    expect(state.workflow.phase).toBe("APPROVED");
    expect(() =>
      reviewControllerReducer(state, completeReviewSimulation(simulation)),
    ).toThrow(/external-diff/i);
    expect(state.workflow.phase).toBe("APPROVED");
  });
});
