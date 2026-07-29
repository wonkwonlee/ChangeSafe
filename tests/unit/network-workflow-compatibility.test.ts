import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkflow } from "@/components/useWorkflow";
import { NETWORK_REVIEW_EXAMPLES } from "@/features/domains/network/examples";
import { legacyNetworkAnalysisTransport } from "@/features/domains/network/useNetworkWorkflow";
import type { ReviewTransportRequest } from "@/features/reviews/useReviewController";
import { getScenario } from "@/scenarios";

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
        ? replay.session
        : {
            ...replay.session,
            source: "live-model",
            analysisMode: "live",
            provenance: "live-model",
          },
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
      session: { analysisMode: "replay", runtimeMode: "public-replay" },
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
});
