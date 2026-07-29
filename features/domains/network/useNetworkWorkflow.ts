"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AnalyzeErrorSchema,
  AnalyzeSuccessSchema,
  StatusResponseSchema,
} from "@/lib/domain/api";
import { APP_VERSION } from "@/lib/domain/version";
import { getScenario, SCENARIOS } from "@/scenarios";
import {
  evaluatePolicies,
  toDomainError,
  type AnalysisMode,
  type FixtureProvenance,
} from "@changesafe/core";
import {
  networkDomain,
  runSimulation,
  type IncidentBundle,
} from "@changesafe/domain-network";

import { NETWORK_REVIEW_EXAMPLES } from "./examples";
import { createNetworkReviewReceipt } from "./receipt";
import {
  ReviewAnalysisResultSchema,
  type ReviewSessionEnvelope,
  type ReviewTransportError,
  type ReviewProvenance,
} from "../review-contract";
import {
  approveReview,
  completeReviewSimulation,
  rejectReview,
  reviewControllerReducer,
} from "../../reviews/controller";
import {
  useReviewController,
  type ReviewTransport,
} from "../../reviews/useReviewController";

/** Fixture metadata shown alongside a replay analysis; null before analysis. */
export interface AnalysisMeta {
  readonly model: string | null;
  readonly provider: string | null;
  readonly fixtureId: string | null;
  readonly fixtureNotes: string | null;
}

/** Which provider live mode would call, as reported by /api/status. */
export interface LiveProviderInfo {
  readonly provider: string;
  readonly model: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama",
};

/** Client-only display label; provider adapters never enter the browser bundle. */
export function providerLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return PROVIDER_LABELS[id] ?? id;
}

const FIRST_SCENARIO = (() => {
  const first = SCENARIOS[0];
  if (!first) throw new Error("no bundled scenarios");
  return first;
})();

const firstExample = exampleFor(FIRST_SCENARIO.scenarioId);

/**
 * Compatibility façade for the existing Network console consumers.
 *
 * The V1 public review transport remains replay-only. This façade deliberately
 * keeps the established /api/analyze live path available to the legacy console
 * while translating its validated response into the controller contract. It
 * does not create a new live transport or grant any execution authority.
 */
export function useNetworkWorkflow() {
  const controller = useReviewController<IncidentBundle>({
    sourceId: FIRST_SCENARIO.scenarioId,
    input: FIRST_SCENARIO.bundle,
    expectedInputId: FIRST_SCENARIO.bundle.incidentId,
    session: firstExample.session,
    transport: legacyNetworkAnalysisTransport,
  });
  const [liveAvailable, setLiveAvailable] = useState<boolean | null>(null);
  const [liveProvider, setLiveProvider] = useState<LiveProviderInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then(async (response) => StatusResponseSchema.parse(await response.json()))
      .then((status) => {
        if (cancelled) return;
        setLiveAvailable(status.liveAvailable);
        setLiveProvider(
          status.provider && status.model
            ? { provider: status.provider, model: status.model }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setLiveAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectScenario = useCallback(
    (scenarioId: string) => {
      const scenario = getScenario(scenarioId);
      if (!scenario) return;
      const example = exampleFor(scenario.scenarioId);
      controller.rebind({
        sourceId: scenario.scenarioId,
        input: scenario.bundle,
        expectedInputId: scenario.bundle.incidentId,
        session: example.session,
      });
    },
    [controller],
  );

  const reset = useCallback(() => {
    selectScenario(controller.state.workflow.sourceId);
  }, [controller.state.workflow.sourceId, selectScenario]);

  const analyze = useCallback(
    async (mode: AnalysisMode) => {
      const { workflow } = controller.state;
      if (workflow.phase !== "READY" && workflow.phase !== "ERROR") return;
      const scenario = getScenario(workflow.sourceId);
      if (!scenario) return;
      const example = exampleFor(scenario.scenarioId);
      controller.rebind({
        sourceId: scenario.scenarioId,
        input: scenario.bundle,
        expectedInputId: scenario.bundle.incidentId,
        session: sessionForMode(example.session, mode),
      });
      await controller.analyze();
    },
    [controller],
  );

  const approve = useCallback(async () => {
    const reviewState = controller.state;
    if (reviewState.workflow.phase !== "APPROVAL_REQUIRED") return;
    try {
      const approved = reviewControllerReducer(reviewState, approveReview());
      if (approved.workflow.phase !== "APPROVED") return;
      const simulation = runSimulation(
        approved.workflow.input,
        approved.workflow.proposal,
      );
      const simulated = reviewControllerReducer(
        approved,
        completeReviewSimulation(simulation),
      );
      controller.approve();
      controller.completeSimulation(simulation);
      const receipt = await createNetworkReviewReceipt(simulated, {
        appVersion: APP_VERSION,
      });
      await controller.recordReceipt(receipt);
    } catch (error) {
      // The review controller already fails closed for malformed transport and
      // receipt input. Simulation exceptions retain the legacy safe failure.
      // Do not synthesize a receipt after an unsuccessful sandbox operation.
      void toDomainError(error, "Simulation failed. State was not changed.");
    }
  }, [controller]);

  const reject = useCallback(async () => {
    const reviewState = controller.state;
    if (reviewState.workflow.phase !== "APPROVAL_REQUIRED") return;
    try {
      const rejected = reviewControllerReducer(reviewState, rejectReview());
      controller.reject();
      const receipt = await createNetworkReviewReceipt(rejected, {
        appVersion: APP_VERSION,
      });
      await controller.recordReceipt(receipt);
    } catch {
      // A receipt that cannot be created is not recorded. The controller's
      // receipt verifier remains the only transition to RECEIPT_ISSUED.
    }
  }, [controller]);

  const issueBlockedReceipt = useCallback(async () => {
    const reviewState = controller.state;
    if (reviewState.workflow.phase !== "BLOCKED") return;
    try {
      const receipt = await createNetworkReviewReceipt(reviewState, {
        appVersion: APP_VERSION,
      });
      await controller.recordReceipt(receipt);
    } catch {
      // A malformed or stale receipt cannot advance the workflow.
    }
  }, [controller]);

  const analysisMeta = useMemo<AnalysisMeta | null>(() => {
    const provenance = controller.state.review?.provenance;
    if (!provenance) return null;
    return {
      model: provenance.model,
      provider: provenance.provider,
      fixtureId: provenance.fixtureId,
      fixtureNotes: provenance.notes,
    };
  }, [controller.state.review]);

  const replayOffer =
    controller.state.workflow.phase === "ERROR" &&
    controller.state.session.analysisMode === "live" &&
    (controller.transportError?.replayAvailable ?? true);

  return {
    state: controller.state.workflow,
    scenarios: SCENARIOS,
    liveAvailable,
    liveProvider,
    analysisMeta,
    replayOffer,
    selectScenario,
    reset,
    analyze,
    approve,
    reject,
    issueBlockedReceipt,
  };
}

function exampleFor(scenarioId: string) {
  const example = NETWORK_REVIEW_EXAMPLES.find(
    (candidate) => candidate.sourceId === scenarioId,
  );
  if (!example) throw new Error(`Network scenario "${scenarioId}" is not registered for review`);
  return example;
}

function sessionForMode(
  replaySession: ReviewSessionEnvelope,
  mode: AnalysisMode,
): ReviewSessionEnvelope {
  if (mode === "replay") return replaySession;
  return {
    ...replaySession,
    source: "live-model",
    analysisMode: "live",
    provenance: "live-model",
  };
}

export const legacyNetworkAnalysisTransport: ReviewTransport<IncidentBundle> = async (
  request,
) => {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenarioId: request.sourceId,
      mode: request.session.analysisMode,
    }),
    signal: request.signal,
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    return {
      attemptId: request.attemptId,
      payload: legacyError(request, payload),
    };
  }

  const success = AnalyzeSuccessSchema.parse(payload);
  const validationError = validateLegacySuccess(request, success);
  if (validationError) {
    return {
      attemptId: request.attemptId,
      payload: validationError,
    };
  }
  const evaluation = evaluatePolicies(networkDomain, request.input, success.proposal);
  return {
    attemptId: request.attemptId,
    payload: ReviewAnalysisResultSchema.parse({
      ok: true,
      contractVersion: request.session.contractVersion,
      domainId: "network",
      session: request.session,
      sourceId: request.sourceId,
      inputId: request.expectedInputId,
      input: request.input,
      proposal: success.proposal,
      findings: evaluation.findings,
      riskLevel: evaluation.riskLevel,
      provenance: {
        classification: request.session.provenance,
        model: success.model,
        provider: success.provider,
        fixtureId: success.fixtureId,
        notes: success.fixtureNotes,
      },
      effectCapability: { kind: "sandbox-simulation" },
    }),
  };
};

/**
 * The legacy endpoint predates the review contract, so its response must not
 * be allowed to redefine the mode or provenance of an already-bound session.
 * Returning a transport error keeps the controller in its normal fail-closed
 * lifecycle instead of producing an approvable review from mismatched data.
 */
function validateLegacySuccess(
  request: Parameters<ReviewTransport<IncidentBundle>>[0],
  success: ReturnType<typeof AnalyzeSuccessSchema.parse>,
): ReviewTransportError | null {
  if (success.mode !== request.session.analysisMode) {
    return invalidLegacySuccess(
      request,
      "Analysis response mode did not match the active review session.",
    );
  }

  if (
    request.session.analysisMode === "replay" &&
    (!success.provenance ||
      replayProvenance(success.provenance) !== request.session.provenance)
  ) {
    return invalidLegacySuccess(
      request,
      "Replay fixture provenance did not match the active review session.",
    );
  }

  if (request.session.analysisMode === "replay") {
    const scenario = getScenario(request.sourceId);
    // A replay response is only safe for the fixture that the session bound
    // before the request began. Compare the core fixture provenance directly
    // as well as the review-session classification: the latter is a display
    // projection and must never become the authority for receipt provenance.
    // Fixture id, model, provider, and notes bind the remaining replay claims.
    if (
      !scenario ||
      success.fixtureId !== scenario.fixture.fixtureId ||
      success.provenance !== scenario.fixture.provenance ||
      success.model !== scenario.fixture.model ||
      success.provider !== null ||
      success.fixtureNotes !== scenario.fixture.notes
    ) {
      return invalidLegacySuccess(
        request,
        "Replay fixture identity did not match the requested scenario.",
      );
    }
  }

  return null;
}

function replayProvenance(provenance: FixtureProvenance): ReviewProvenance {
  switch (provenance) {
    case "captured":
      return "captured-replay";
    case "authored_synthetic":
      return "authored-synthetic";
    case "authored_red_team":
      return "authored-red-team";
  }
}

function invalidLegacySuccess(
  request: Parameters<ReviewTransport<IncidentBundle>>[0],
  message: string,
): ReviewTransportError {
  if (request.session.analysisMode === "live") {
    return {
      ok: false,
      contractVersion: request.session.contractVersion,
      error: {
        code: "ANALYSIS_INVALID",
        message,
        domainId: "network",
        replayAvailable: true,
        replaySource: {
          domainId: "network",
          contractVersion: request.session.contractVersion,
          sourceId: request.sourceId,
        },
        expectedContractVersion: null,
        receivedContractVersion: null,
      },
    };
  }

  return {
    ok: false,
    contractVersion: request.session.contractVersion,
    error: {
      code: "ANALYSIS_INVALID",
      message,
      domainId: "network",
      replayAvailable: false,
      expectedContractVersion: null,
      receivedContractVersion: null,
    },
  };
}

function legacyError(
  request: Parameters<ReviewTransport<IncidentBundle>>[0],
  payload: unknown,
): ReviewTransportError {
  const parsed = AnalyzeErrorSchema.safeParse(payload);
  const replayAvailable =
    request.session.analysisMode === "live" &&
    (parsed.success ? parsed.data.error.replayAvailable : true);
  if (replayAvailable) {
    return {
      ok: false,
      contractVersion: request.session.contractVersion,
      error: {
        code: "ANALYSIS_UNAVAILABLE",
        message: parsed.success
          ? parsed.data.error.message
          : "Analysis failed unexpectedly.",
        domainId: "network",
        replayAvailable: true,
        replaySource: {
          domainId: "network",
          contractVersion: request.session.contractVersion,
          sourceId: request.sourceId,
        },
        expectedContractVersion: null,
        receivedContractVersion: null,
      },
    };
  }
  return {
    ok: false,
    contractVersion: request.session.contractVersion,
    error: {
      code: "ANALYSIS_FAILED",
      message: parsed.success
        ? parsed.data.error.message
        : "Analysis failed unexpectedly.",
      domainId: "network",
      replayAvailable: false,
      expectedContractVersion: null,
      receivedContractVersion: null,
    },
  };
}
