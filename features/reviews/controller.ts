import {
  IdSchema,
  IllegalTransitionError,
  SimulationResultSchema,
  canonicallyEqual,
  initialState,
  transition,
  type FixtureProvenance,
  type WorkflowState,
} from "@changesafe/core";

import {
  ReviewAnalysisResultSchema,
  ReviewSessionEnvelopeSchema,
  type ReviewAnalysisResult,
  type ReviewSessionEnvelope,
} from "../domains/review-contract";

export const SAFE_REVIEW_ERROR_MESSAGE =
  "Review analysis could not be loaded safely.";

export interface ActiveReviewRequest {
  readonly attemptId: string;
}

export interface ReviewControllerState<TInput> {
  readonly session: ReviewSessionEnvelope;
  readonly expectedInputId: string;
  readonly workflow: WorkflowState<TInput>;
  readonly review: ReviewAnalysisResult | null;
  readonly activeRequest: ActiveReviewRequest | null;
}

export type ReviewControllerCommand =
  | {
      readonly type: "START_REVIEW";
      readonly attemptId: string;
    }
  | {
      readonly type: "REVIEW_TRANSPORT_RECEIVED";
      readonly attemptId: string;
      readonly payload: unknown;
    }
  | { readonly type: "APPROVE_REVIEW" }
  | { readonly type: "SIMULATION_COMPLETED"; readonly simulation: unknown };

export interface InitialReviewControllerInput<TInput> {
  readonly sourceId: string;
  readonly input: TInput;
  readonly expectedInputId: string;
  readonly session: ReviewSessionEnvelope;
}

export function initialReviewControllerState<TInput>(
  source: InitialReviewControllerInput<TInput>,
): ReviewControllerState<TInput> {
  const sourceId = IdSchema.parse(source.sourceId);
  const expectedInputId = IdSchema.parse(source.expectedInputId);
  const session = ReviewSessionEnvelopeSchema.parse(source.session);
  return {
    session,
    expectedInputId,
    workflow: initialState(sourceId, source.input),
    review: null,
    activeRequest: null,
  };
}

export function startReview(attemptId: string): ReviewControllerCommand {
  return { type: "START_REVIEW", attemptId };
}

export function receiveReviewTransport(
  attemptId: string,
  payload: unknown,
): ReviewControllerCommand {
  return { type: "REVIEW_TRANSPORT_RECEIVED", attemptId, payload };
}

export function approveReview(): ReviewControllerCommand {
  return { type: "APPROVE_REVIEW" };
}

export function completeReviewSimulation(
  simulation: unknown,
): ReviewControllerCommand {
  return { type: "SIMULATION_COMPLETED", simulation };
}

export function reviewControllerReducer<TInput>(
  state: ReviewControllerState<TInput>,
  command: ReviewControllerCommand,
): ReviewControllerState<TInput> {
  switch (command.type) {
    case "START_REVIEW": {
      const activeRequest = {
        attemptId: IdSchema.parse(command.attemptId),
      };
      return {
        ...state,
        review: null,
        activeRequest,
        workflow: transition(state.workflow, {
          type: "START_ANALYSIS",
          mode: state.session.analysisMode,
        }),
      };
    }

    case "REVIEW_TRANSPORT_RECEIVED": {
      const attemptId = IdSchema.parse(command.attemptId);
      if (
        state.activeRequest === null ||
        attemptId !== state.activeRequest.attemptId
      ) {
        return state;
      }
      return receiveTransport(
        state,
        command.payload,
        state.expectedInputId,
      );
    }

    case "APPROVE_REVIEW":
      return {
        ...state,
        workflow: transition(state.workflow, { type: "APPROVE" }),
      };

    case "SIMULATION_COMPLETED": {
      if (state.review?.effectCapability.kind !== "sandbox-simulation") {
        const effectKind = state.review?.effectCapability.kind ?? "unavailable";
        throw new IllegalTransitionError(
          state.workflow.phase,
          "SIMULATION_COMPLETED",
          `${effectKind} reviews have no sandbox simulation`,
        );
      }
      const parsed = SimulationResultSchema.safeParse(command.simulation);
      if (!parsed.success) {
        return failSafely(state);
      }
      return {
        ...state,
        activeRequest: null,
        workflow: transition(state.workflow, {
          type: "SIMULATION_COMPLETED",
          simulation: parsed.data,
        }),
      };
    }

    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

export function reviewCanSimulate<TInput>(
  state: ReviewControllerState<TInput>,
): boolean {
  return (
    state.workflow.phase === "APPROVED" &&
    state.review?.effectCapability.kind === "sandbox-simulation"
  );
}

function receiveTransport<TInput>(
  state: ReviewControllerState<TInput>,
  payload: unknown,
  expectedInputId: string,
): ReviewControllerState<TInput> {
  const parsed = ReviewAnalysisResultSchema.safeParse(payload);
  if (!parsed.success) {
    return failSafely(state);
  }

  const review = parsed.data;
  try {
    if (
      review.inputId !== expectedInputId ||
      review.sourceId !== state.workflow.sourceId ||
      !canonicallyEqual(review.session, state.session) ||
      !canonicallyEqual(review.input, state.workflow.input)
    ) {
      return failSafely(state);
    }
  } catch {
    return failSafely(state);
  }

  let workflow = transition(state.workflow, {
    type: "PROPOSAL_RECEIVED",
    proposal: review.proposal,
    mode: review.session.analysisMode,
    provenance: coreProvenance(review),
  });
  workflow = transition(workflow, {
    type: "VALIDATION_COMPLETED",
    findings: review.findings,
    riskLevel: review.riskLevel,
  });
  workflow = transition(workflow, { type: "CLASSIFY" });
  return { ...state, workflow, review, activeRequest: null };
}

function failSafely<TInput>(
  state: ReviewControllerState<TInput>,
): ReviewControllerState<TInput> {
  return {
    ...state,
    review: null,
    activeRequest: null,
    workflow: transition(state.workflow, {
      type: "FAIL",
      userMessage: SAFE_REVIEW_ERROR_MESSAGE,
    }),
  };
}

function coreProvenance(
  review: ReviewAnalysisResult,
): FixtureProvenance | null {
  switch (review.provenance.classification) {
    case "captured-replay":
      return "captured";
    case "authored-synthetic":
      return "authored_synthetic";
    case "authored-red-team":
      return "authored_red_team";
    case "live-model":
    case "uploaded-offline-artifact":
    case "read-only-collector":
      return null;
  }
}
