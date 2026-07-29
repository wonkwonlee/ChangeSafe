import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkflow } from "@/components/useWorkflow";
import { NETWORK_REVIEW_EXAMPLES } from "@/features/domains/network/examples";
import { createNetworkReviewReceipt } from "@/features/domains/network/receipt";
import {
  legacyNetworkAnalysisTransport,
  legacyNetworkReviewSession,
} from "@/features/domains/network/useNetworkWorkflow";
import {
  approveReview,
  completeReviewSimulation,
  initialReviewControllerState,
  receiveReviewTransport,
  recordReviewReceipt,
  reviewControllerReducer,
  startReview,
} from "@/features/reviews/controller";
import type { ReviewTransportRequest } from "@/features/reviews/useReviewController";
import { getScenario } from "@/scenarios";
import { runSimulation } from "@changesafe/domain-network";

function scenarioOrThrow() {
  const scenario = getScenario("scenario-a-failover");
  if (!scenario) throw new Error("missing bundled Network scenario");
  return scenario;
}

function scenarioByIdOrThrow(scenarioId: string) {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`missing bundled Network scenario ${scenarioId}`);
  return scenario;
}

function requestFor(
  mode: "replay" | "live",
): ReviewTransportRequest<ReturnType<typeof scenarioOrThrow>["bundle"]> {
  const scenario = scenarioOrThrow();
  const replay = NETWORK_REVIEW_EXAMPLES.find(
    (example) => example.sourceId === scenario.scenarioId,
  );
  if (!replay) throw new Error("missing Network review example");
  return {
    attemptId: "attempt-network-compat",
    sourceId: scenario.scenarioId,
    expectedInputId: scenario.bundle.incidentId,
    input: scenario.bundle,
    session:
      mode === "replay"
        ? legacyNetworkReviewSession(replay.session, "replay")
        : legacyNetworkReviewSession(replay.session, "live"),
    signal: new AbortController().signal,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Network workflow compatibility facade", () => {
  it("preserves the existing console hook surface without starting analysis on SSR", () => {
    function Probe() {
      const controller = useWorkflow();
      return createElement(
        "span",
        null,
        [
          controller.state.phase,
          controller.scenarios.length,
          typeof controller.selectScenario,
          typeof controller.reset,
          typeof controller.analyze,
          typeof controller.approve,
          typeof controller.reject,
          typeof controller.issueBlockedReceipt,
        ].join(":"),
      );
    }

    expect(renderToString(createElement(Probe))).toContain(
      "READY:9:function:function:function:function:function:function",
    );
  });

  it("maps the validated legacy replay response into the review-controller contract", async () => {
    const scenario = scenarioOrThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          mode: "replay",
          model: scenario.fixture.model,
          provider: null,
          provenance: scenario.fixture.provenance,
          fixtureId: scenario.fixture.fixtureId,
          fixtureNotes: scenario.fixture.notes,
          proposal: scenario.fixture.proposal,
        }),
      ),
    );

    const result = await legacyNetworkAnalysisTransport(requestFor("replay"));

    expect(result.attemptId).toBe("attempt-network-compat");
    expect(result.payload).toMatchObject({
      ok: true,
      sourceId: scenario.scenarioId,
      inputId: scenario.bundle.incidentId,
      session: {
        analysisMode: "replay",
        runtimeMode: "legacy-local",
        capabilities: { durableDecision: false },
      },
      effectCapability: { kind: "sandbox-simulation" },
    });
  });

  it("fails closed when a legacy success response reports a different analysis mode", async () => {
    const scenario = scenarioOrThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          mode: "replay",
          model: scenario.fixture.model,
          provider: null,
          provenance: scenario.fixture.provenance,
          fixtureId: scenario.fixture.fixtureId,
          fixtureNotes: scenario.fixture.notes,
          proposal: scenario.fixture.proposal,
        }),
      ),
    );

    const result = await legacyNetworkAnalysisTransport(requestFor("live"));

    expect(result.payload).toEqual({
      ok: false,
      contractVersion: "2.0.0",
      error: {
        code: "ANALYSIS_INVALID",
        message: "Analysis response mode did not match the active review session.",
        domainId: "network",
        replayAvailable: true,
        replaySource: {
          domainId: "network",
          contractVersion: "2.0.0",
          sourceId: "scenario-a-failover",
        },
        expectedContractVersion: null,
        receivedContractVersion: null,
      },
    });
  });

  it("fails closed when replay fixture provenance cannot satisfy the bound session", async () => {
    const scenario = scenarioOrThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          mode: "replay",
          model: null,
          provider: null,
          provenance: "authored_red_team",
          fixtureId: scenario.fixture.fixtureId,
          fixtureNotes: scenario.fixture.notes,
          proposal: scenario.fixture.proposal,
        }),
      ),
    );

    const result = await legacyNetworkAnalysisTransport(requestFor("replay"));

    expect(result.payload).toEqual({
      ok: false,
      contractVersion: "2.0.0",
      error: {
        code: "ANALYSIS_INVALID",
        message: "Replay fixture provenance did not match the active review session.",
        domainId: "network",
        replayAvailable: false,
        expectedContractVersion: null,
        receivedContractVersion: null,
      },
    });
  });

  it("binds replay provenance to the requested fixture, not only the session classification", async () => {
    const requested = scenarioByIdOrThrow("scenario-b-route-leak");
    const replay = NETWORK_REVIEW_EXAMPLES.find(
      (example) => example.sourceId === requested.scenarioId,
    );
    if (!replay) throw new Error("missing Network review example");
    const synthetic = scenarioByIdOrThrow("scenario-c-route-flap");
    // This deliberately malformed caller session is internally coherent with
    // the response. The transport must still compare against the immutable
    // scenario fixture selected before analysis began.
    const session = {
      ...replay.session,
      provenance: "authored-synthetic" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          mode: "replay",
          model: synthetic.fixture.model,
          provider: null,
          provenance: synthetic.fixture.provenance,
          fixtureId: requested.fixture.fixtureId,
          fixtureNotes: requested.fixture.notes,
          proposal: requested.fixture.proposal,
        }),
      ),
    );

    const result = await legacyNetworkAnalysisTransport({
      ...requestFor("replay"),
      sourceId: requested.scenarioId,
      expectedInputId: requested.bundle.incidentId,
      input: requested.bundle,
      session,
    });

    expect(result.payload).toMatchObject({
      ok: false,
      error: {
        code: "ANALYSIS_INVALID",
        message: "Replay fixture identity did not match the requested scenario.",
        replayAvailable: false,
      },
    });
    expect(result.payload).not.toHaveProperty("proposal");
    expect(result.payload).not.toHaveProperty("receipt");
  });

  it("fails closed when a different captured fixture claims the same provenance class", async () => {
    const scenario = scenarioOrThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          mode: "replay",
          model: scenario.fixture.model,
          provider: null,
          provenance: scenario.fixture.provenance,
          fixtureId: "fix-other-captured-fixture",
          fixtureNotes: scenario.fixture.notes,
          proposal: scenario.fixture.proposal,
        }),
      ),
    );

    const result = await legacyNetworkAnalysisTransport(requestFor("replay"));

    expect(result.payload).toMatchObject({
      ok: false,
      error: {
        code: "ANALYSIS_INVALID",
        message: "Replay fixture identity did not match the requested scenario.",
        replayAvailable: false,
      },
    });
  });

  it("fails closed when another authored red-team fixture has the same provenance class", async () => {
    const requested = scenarioByIdOrThrow("scenario-b-route-leak");
    const otherAuthored = scenarioByIdOrThrow("scenario-e-rollback-trap");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          mode: "replay",
          model: otherAuthored.fixture.model,
          provider: null,
          provenance: otherAuthored.fixture.provenance,
          fixtureId: otherAuthored.fixture.fixtureId,
          fixtureNotes: otherAuthored.fixture.notes,
          proposal: otherAuthored.fixture.proposal,
        }),
      ),
    );

    const replay = NETWORK_REVIEW_EXAMPLES.find(
      (example) => example.sourceId === requested.scenarioId,
    );
    if (!replay) throw new Error("missing Network review example");
    const result = await legacyNetworkAnalysisTransport({
      ...requestFor("replay"),
      sourceId: requested.scenarioId,
      expectedInputId: requested.bundle.incidentId,
      input: requested.bundle,
      session: replay.session,
    });

    expect(result.payload).toMatchObject({
      ok: false,
      error: {
        code: "ANALYSIS_INVALID",
        message: "Replay fixture identity did not match the requested scenario.",
        replayAvailable: false,
      },
    });
  });

  it("fails closed when another authored synthetic fixture has the same provenance class", async () => {
    const requested = scenarioByIdOrThrow("scenario-c-route-flap");
    const otherSynthetic = scenarioByIdOrThrow("scenario-d-egress-imbalance");
    expect(requested.fixture.provenance).toBe("authored_synthetic");
    expect(otherSynthetic.fixture.provenance).toBe("authored_synthetic");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          mode: "replay",
          model: otherSynthetic.fixture.model,
          provider: null,
          provenance: otherSynthetic.fixture.provenance,
          fixtureId: otherSynthetic.fixture.fixtureId,
          fixtureNotes: otherSynthetic.fixture.notes,
          proposal: otherSynthetic.fixture.proposal,
        }),
      ),
    );

    const replay = NETWORK_REVIEW_EXAMPLES.find(
      (example) => example.sourceId === requested.scenarioId,
    );
    if (!replay) throw new Error("missing Network review example");
    const result = await legacyNetworkAnalysisTransport({
      ...requestFor("replay"),
      sourceId: requested.scenarioId,
      expectedInputId: requested.bundle.incidentId,
      input: requested.bundle,
      session: replay.session,
    });

    expect(result.payload).toMatchObject({
      ok: false,
      error: {
        code: "ANALYSIS_INVALID",
        message: "Replay fixture identity did not match the requested scenario.",
        replayAvailable: false,
      },
    });
    expect(result.payload).not.toHaveProperty("proposal");
    expect(result.payload).not.toHaveProperty("receipt");
  });

  it.each([
    ["model", "other-model"],
    ["provider", "openai"],
    ["fixture notes", "other fixture notes"],
  ] as const)(
    "fails closed when a replay response has mismatched %s without producing a review result",
    async (field, replacement) => {
      const scenario = scenarioOrThrow();
      const response = {
        mode: "replay" as const,
        model: scenario.fixture.model,
        provider: null as string | null,
        provenance: scenario.fixture.provenance,
        fixtureId: scenario.fixture.fixtureId,
        fixtureNotes: scenario.fixture.notes,
        proposal: scenario.fixture.proposal,
      };
      if (field === "model") response.model = replacement;
      if (field === "provider") response.provider = replacement;
      if (field === "fixture notes") response.fixtureNotes = replacement;
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(response)));

      const result = await legacyNetworkAnalysisTransport(requestFor("replay"));

      expect(result.payload).toMatchObject({
        ok: false,
        error: {
          code: "ANALYSIS_INVALID",
          message: "Replay fixture identity did not match the requested scenario.",
          replayAvailable: false,
        },
      });
      expect(result.payload).not.toHaveProperty("proposal");
      expect(result.payload).not.toHaveProperty("receipt");
    },
  );

  it("accepts the required null replay provider and rejects a provider claim", async () => {
    const scenario = scenarioOrThrow();
    const replayResponse = {
      mode: "replay" as const,
      model: scenario.fixture.model,
      provider: null as string | null,
      provenance: scenario.fixture.provenance,
      fixtureId: scenario.fixture.fixtureId,
      fixtureNotes: scenario.fixture.notes,
      proposal: scenario.fixture.proposal,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(Response.json(replayResponse))
        .mockResolvedValueOnce(
          Response.json({ ...replayResponse, provider: "openai" }),
        ),
    );

    const accepted = await legacyNetworkAnalysisTransport(requestFor("replay"));
    const rejected = await legacyNetworkAnalysisTransport(requestFor("replay"));

    expect(accepted.payload).toMatchObject({ ok: true });
    expect(rejected.payload).toMatchObject({
      ok: false,
      error: {
        code: "ANALYSIS_INVALID",
        message: "Replay fixture identity did not match the requested scenario.",
      },
    });
  });

  it("keeps legacy live failures replay-eligible without changing the public V1 transport", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "AI_UNAVAILABLE",
              message: "Live analysis is unavailable.",
              replayAvailable: true,
            },
          },
          { status: 503 },
        ),
      ),
    );

    const result = await legacyNetworkAnalysisTransport(requestFor("live"));

    expect(result.payload).toEqual({
      ok: false,
      contractVersion: "2.0.0",
      error: {
        code: "ANALYSIS_UNAVAILABLE",
        message: "Live analysis is unavailable.",
        domainId: "network",
        replayAvailable: true,
        replaySource: {
          domainId: "network",
          contractVersion: "2.0.0",
          sourceId: "scenario-a-failover",
        },
        expectedContractVersion: null,
        receivedContractVersion: null,
      },
    });
  });

  it("keeps the legacy local lifecycle while public replay stays decision-free and blocked", async () => {
    const safeScenario = scenarioOrThrow();
    const safeReplay = NETWORK_REVIEW_EXAMPLES.find(
      (example) => example.sourceId === safeScenario.scenarioId,
    );
    if (!safeReplay) throw new Error("missing safe Network review example");
    const safeResponse = {
      mode: "replay" as const,
      model: safeScenario.fixture.model,
      provider: null,
      provenance: safeScenario.fixture.provenance,
      fixtureId: safeScenario.fixture.fixtureId,
      fixtureNotes: safeScenario.fixture.notes,
      proposal: safeScenario.fixture.proposal,
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(safeResponse)));

    const legacyRequest = requestFor("replay");
    const legacyResult = await legacyNetworkAnalysisTransport(legacyRequest);
    let legacy = initialReviewControllerState({
      sourceId: legacyRequest.sourceId,
      input: legacyRequest.input,
      expectedInputId: legacyRequest.expectedInputId,
      session: legacyRequest.session,
    });
    legacy = reviewControllerReducer(legacy, startReview(legacyRequest.attemptId));
    legacy = reviewControllerReducer(
      legacy,
      receiveReviewTransport(legacyRequest.attemptId, legacyResult.payload),
    );
    expect(legacy.workflow.phase).toBe("APPROVAL_REQUIRED");
    legacy = reviewControllerReducer(legacy, approveReview());
    expect(legacy.workflow.phase).toBe("APPROVED");
    if (legacy.workflow.phase !== "APPROVED") throw new Error("safe review did not approve");
    legacy = reviewControllerReducer(
      legacy,
      completeReviewSimulation(
        runSimulation(legacy.workflow.input, legacy.workflow.proposal),
      ),
    );
    expect(legacy.workflow.phase).toBe("SIMULATED");
    const receipt = await createNetworkReviewReceipt(legacy, { appVersion: "test" });
    legacy = reviewControllerReducer(
      legacy,
      await recordReviewReceipt(legacy, receipt),
    );
    expect(legacy.workflow.phase).toBe("RECEIPT_ISSUED");

    const publicRequest = {
      ...legacyRequest,
      attemptId: "attempt-public-replay",
      session: safeReplay.session,
    };
    const publicResult = await legacyNetworkAnalysisTransport(publicRequest);
    let publicReplay = initialReviewControllerState({
      sourceId: publicRequest.sourceId,
      input: publicRequest.input,
      expectedInputId: publicRequest.expectedInputId,
      session: publicRequest.session,
    });
    publicReplay = reviewControllerReducer(
      publicReplay,
      startReview(publicRequest.attemptId),
    );
    publicReplay = reviewControllerReducer(
      publicReplay,
      receiveReviewTransport(publicRequest.attemptId, publicResult.payload),
    );
    expect(publicReplay.workflow.phase).toBe("APPROVAL_REQUIRED");
    expect(reviewControllerReducer(publicReplay, approveReview())).toBe(publicReplay);
    await expect(recordReviewReceipt(publicReplay, receipt)).rejects.toThrow(
      /public replay.*receipt/i,
    );

    const blockedScenario = scenarioByIdOrThrow("scenario-b-route-leak");
    const blockedReplay = NETWORK_REVIEW_EXAMPLES.find(
      (example) => example.sourceId === blockedScenario.scenarioId,
    );
    if (!blockedReplay) throw new Error("missing blocked Network review example");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          mode: "replay",
          model: blockedScenario.fixture.model,
          provider: null,
          provenance: blockedScenario.fixture.provenance,
          fixtureId: blockedScenario.fixture.fixtureId,
          fixtureNotes: blockedScenario.fixture.notes,
          proposal: blockedScenario.fixture.proposal,
        }),
      ),
    );
    const blockedRequest = {
      ...publicRequest,
      attemptId: "attempt-public-blocked",
      sourceId: blockedScenario.scenarioId,
      expectedInputId: blockedScenario.bundle.incidentId,
      input: blockedScenario.bundle,
      session: blockedReplay.session,
    };
    const blockedResult = await legacyNetworkAnalysisTransport(blockedRequest);
    let blocked = initialReviewControllerState({
      sourceId: blockedScenario.scenarioId,
      input: blockedScenario.bundle,
      expectedInputId: blockedScenario.bundle.incidentId,
      session: blockedReplay.session,
    });
    blocked = reviewControllerReducer(blocked, startReview(blockedRequest.attemptId));
    blocked = reviewControllerReducer(
      blocked,
      receiveReviewTransport(blockedRequest.attemptId, blockedResult.payload),
    );
    expect(blocked.workflow.phase).toBe("BLOCKED");
    expect(reviewControllerReducer(blocked, approveReview())).toBe(blocked);
  });
});
