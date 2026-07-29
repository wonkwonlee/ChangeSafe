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
