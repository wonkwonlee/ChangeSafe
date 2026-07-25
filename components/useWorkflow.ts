"use client";

import { useCallback, useEffect, useReducer, useState } from "react";

import {
  AnalyzeErrorSchema,
  AnalyzeSuccessSchema,
  StatusResponseSchema,
} from "@/lib/domain/api";
import {
  createReceipt,
  evaluatePolicies,
  initialState,
  toDomainError,
  transition,
  type AnalysisMode,
  type WorkflowEvent,
  type WorkflowState,
} from "@changesafe/core";
import {
  networkDomain,
  runSimulation,
  POLICY_VERSION,
  type IncidentBundle,
} from "@changesafe/domain-network";
import { APP_VERSION } from "@/lib/domain/version";
import { SCENARIOS, getScenario } from "@/scenarios";

/** Fixture metadata shown alongside a replay analysis; null in live mode. */
export interface AnalysisMeta {
  /** The model that actually answered; null for authored replay fixtures. */
  model: string | null;
  provider: string | null;
  fixtureId: string | null;
  fixtureNotes: string | null;
}

/** Which provider live mode would call, as reported by /api/status. */
export interface LiveProviderInfo {
  provider: string;
  model: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama",
};

/**
 * Display name for a provider id. Deliberately defined here rather than
 * imported from @changesafe/ai: the provider adapters are server-side code
 * and must not be pulled into the browser bundle for a label.
 */
export function providerLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return PROVIDER_LABELS[id] ?? id;
}

const FIRST_SCENARIO = (() => {
  const first = SCENARIOS[0];
  if (!first) throw new Error("no bundled scenarios");
  return first;
})();

type BundleWorkflowState = WorkflowState<IncidentBundle>;

function reducer(
  state: BundleWorkflowState,
  event: WorkflowEvent<IncidentBundle>,
): BundleWorkflowState {
  // The domain transition function is the single authority; an illegal event
  // here is a programming error and must fail loudly, not be smoothed over.
  return transition(state, event);
}

export function useWorkflow() {
  const [state, dispatch] = useReducer(
    reducer,
    initialState(FIRST_SCENARIO.scenarioId, FIRST_SCENARIO.bundle),
  );
  const [liveAvailable, setLiveAvailable] = useState<boolean | null>(null);
  const [liveProvider, setLiveProvider] = useState<LiveProviderInfo | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<AnalysisMeta | null>(null);
  const [replayOffer, setReplayOffer] = useState(false);

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

  const selectScenario = useCallback((scenarioId: string) => {
    const scenario = getScenario(scenarioId);
    if (!scenario) return;
    setAnalysisMeta(null);
    setReplayOffer(false);
    dispatch({ type: "RESET", sourceId: scenario.scenarioId, input: scenario.bundle });
  }, []);

  const reset = useCallback(() => {
    selectScenario(state.sourceId);
  }, [selectScenario, state.sourceId]);

  const analyze = useCallback(
    async (mode: AnalysisMode) => {
      if (state.phase !== "READY" && state.phase !== "ERROR") return;
      setReplayOffer(false);
      setAnalysisMeta(null);
      dispatch({ type: "START_ANALYSIS", mode });

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scenarioId: state.sourceId, mode }),
        });
        const payload: unknown = await response.json();

        if (!response.ok) {
          const parsedError = AnalyzeErrorSchema.safeParse(payload);
          const message = parsedError.success
            ? parsedError.data.error.message
            : "Analysis failed unexpectedly.";
          setReplayOffer(
            mode === "live" && (parsedError.success ? parsedError.data.error.replayAvailable : true),
          );
          dispatch({ type: "FAIL", userMessage: message });
          return;
        }

        const success = AnalyzeSuccessSchema.parse(payload);
        setAnalysisMeta({
          model: success.model,
          provider: success.provider,
          fixtureId: success.fixtureId,
          fixtureNotes: success.fixtureNotes,
        });
        dispatch({
          type: "PROPOSAL_RECEIVED",
          proposal: success.proposal,
          mode: success.mode,
          provenance: success.provenance,
        });

        // Deterministic gate runs locally on the validated proposal.
        const { findings, riskLevel } = evaluatePolicies(networkDomain, state.input, success.proposal);
        dispatch({ type: "VALIDATION_COMPLETED", findings, riskLevel });
        dispatch({ type: "CLASSIFY" });
      } catch (error) {
        setReplayOffer(mode === "live");
        dispatch({
          type: "FAIL",
          userMessage: toDomainError(error, "Analysis failed unexpectedly.").userMessage,
        });
      }
    },
    [state.phase, state.sourceId, state.input],
  );

  const approve = useCallback(async () => {
    if (state.phase !== "APPROVAL_REQUIRED") return;
    dispatch({ type: "APPROVE" });
    try {
      const simulation = runSimulation(state.input, state.proposal);
      dispatch({ type: "SIMULATION_COMPLETED", simulation });
      const receipt = await createReceipt({
        sourceId: state.sourceId,
        inputId: state.input.incidentId,
        input: state.input,
        appVersion: APP_VERSION,
        policyVersion: POLICY_VERSION,
        proposal: state.proposal,
        mode: state.mode,
        model: analysisMeta?.model ?? null,
        fixtureProvenance: state.provenance,
        findings: state.findings,
        riskLevel: state.riskLevel,
        decision: "approved",
        simulation,
      });
      dispatch({ type: "RECEIPT_CREATED", receipt });
    } catch (error) {
      dispatch({
        type: "FAIL",
        userMessage: toDomainError(error, "Simulation failed. State was not changed.").userMessage,
      });
    }
  }, [state, analysisMeta]);

  const reject = useCallback(async () => {
    if (state.phase !== "APPROVAL_REQUIRED") return;
    dispatch({ type: "REJECT" });
    const receipt = await createReceipt({
      sourceId: state.sourceId,
      inputId: state.input.incidentId,
      input: state.input,
      appVersion: APP_VERSION,
      policyVersion: POLICY_VERSION,
      proposal: state.proposal,
      mode: state.mode,
      model: analysisMeta?.model ?? null,
      fixtureProvenance: state.provenance,
      findings: state.findings,
      riskLevel: state.riskLevel,
      decision: "rejected",
      simulation: null,
    });
    dispatch({ type: "RECEIPT_CREATED", receipt });
  }, [state, analysisMeta]);

  const issueBlockedReceipt = useCallback(async () => {
    if (state.phase !== "BLOCKED") return;
    const receipt = await createReceipt({
      sourceId: state.sourceId,
      inputId: state.input.incidentId,
      input: state.input,
      appVersion: APP_VERSION,
      policyVersion: POLICY_VERSION,
      proposal: state.proposal,
      mode: state.mode,
      model: analysisMeta?.model ?? null,
      fixtureProvenance: state.provenance,
      findings: state.findings,
      riskLevel: state.riskLevel,
      decision: "blocked",
      simulation: null,
    });
    dispatch({ type: "RECEIPT_CREATED", receipt });
  }, [state, analysisMeta]);

  return {
    state,
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

export type WorkflowController = ReturnType<typeof useWorkflow>;
