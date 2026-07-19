"use client";

import { useCallback, useEffect, useReducer, useState } from "react";

import {
  AnalyzeErrorSchema,
  AnalyzeSuccessSchema,
  StatusResponseSchema,
} from "@/lib/domain/api";
import { toDomainError } from "@/lib/domain/errors";
import type { AnalysisMode } from "@/lib/domain/schemas";
import {
  initialState,
  transition,
  type WorkflowEvent,
  type WorkflowState,
} from "@/lib/domain/state-machine";
import { RUNTIME_MODEL } from "@/lib/domain/version";
import { runSimulation } from "@/lib/patch/simulate";
import { evaluatePolicies } from "@/lib/policies";
import { createReceipt } from "@/lib/receipt/receipt";
import { SCENARIOS, getScenario } from "@/scenarios";

/** Fixture metadata shown alongside a replay analysis; null in live mode. */
export interface AnalysisMeta {
  model: string | null;
  fixtureId: string | null;
  fixtureNotes: string | null;
}

const FIRST_SCENARIO = (() => {
  const first = SCENARIOS[0];
  if (!first) throw new Error("no bundled scenarios");
  return first;
})();

function reducer(state: WorkflowState, event: WorkflowEvent): WorkflowState {
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
  const [analysisMeta, setAnalysisMeta] = useState<AnalysisMeta | null>(null);
  const [replayOffer, setReplayOffer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then(async (response) => StatusResponseSchema.parse(await response.json()))
      .then((status) => {
        if (!cancelled) setLiveAvailable(status.liveAvailable);
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
    dispatch({ type: "RESET", scenarioId: scenario.scenarioId, bundle: scenario.bundle });
  }, []);

  const reset = useCallback(() => {
    selectScenario(state.scenarioId);
  }, [selectScenario, state.scenarioId]);

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
          body: JSON.stringify({ scenarioId: state.scenarioId, mode }),
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
        const { findings, riskLevel } = evaluatePolicies(state.bundle, success.proposal);
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
    [state.phase, state.scenarioId, state.bundle],
  );

  const approve = useCallback(async () => {
    if (state.phase !== "APPROVAL_REQUIRED") return;
    dispatch({ type: "APPROVE" });
    try {
      const simulation = runSimulation(state.bundle, state.proposal);
      dispatch({ type: "SIMULATION_COMPLETED", simulation });
      const receipt = await createReceipt({
        scenarioId: state.scenarioId,
        bundle: state.bundle,
        proposal: state.proposal,
        mode: state.mode,
        model: state.mode === "live" ? RUNTIME_MODEL : (analysisMeta?.model ?? null),
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
      scenarioId: state.scenarioId,
      bundle: state.bundle,
      proposal: state.proposal,
      mode: state.mode,
      model: state.mode === "live" ? RUNTIME_MODEL : (analysisMeta?.model ?? null),
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
      scenarioId: state.scenarioId,
      bundle: state.bundle,
      proposal: state.proposal,
      mode: state.mode,
      model: state.mode === "live" ? RUNTIME_MODEL : (analysisMeta?.model ?? null),
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
