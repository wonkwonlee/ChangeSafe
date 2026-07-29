import {
  ChangeReceiptSchema,
  IdSchema,
  IllegalTransitionError,
  SimulationResultSchema,
  canonicallyEqual,
  hashCanonical,
  initialState,
  transition,
  verifyReceiptHash,
  type ChangeReceipt,
  type FixtureProvenance,
  type ReceiptDecision,
  type WorkflowState,
} from "@changesafe/core";

import {
  ReviewAnalysisResultSchema,
  ReviewSessionEnvelopeSchema,
  ReviewTransportErrorSchema,
  type ReviewAnalysisResult,
  type ReviewSessionEnvelope,
  type ReviewTransportErrorDetail,
} from "../domains/review-contract";

export const SAFE_REVIEW_ERROR_MESSAGE =
  "Review analysis could not be loaded safely.";
export const SAFE_RECEIPT_ERROR_MESSAGE =
  "Review receipt could not be verified safely.";

const verifiedReceiptCommandBrand: unique symbol = Symbol(
  "verified-receipt-command",
);

export interface ActiveReviewRequest {
  readonly attemptId: string;
}

export interface ReviewControllerState<TInput> {
  readonly session: ReviewSessionEnvelope;
  readonly expectedInputId: string;
  readonly workflow: WorkflowState<TInput>;
  readonly review: ReviewAnalysisResult | null;
  readonly transportError: ReviewTransportErrorDetail | null;
  readonly activeRequest: ActiveReviewRequest | null;
}

export type ReviewControllerCommand<TInput = never> =
  | {
      readonly type: "START_REVIEW";
      readonly attemptId: string;
    }
  | {
      readonly type: "REVIEW_TRANSPORT_RECEIVED";
      readonly attemptId: string;
      readonly payload: unknown;
    }
  | {
      readonly type: "REBIND_REVIEW";
      readonly source: InitialReviewControllerInput<TInput>;
    }
  | { readonly type: "APPROVE_REVIEW" }
  | { readonly type: "REJECT_REVIEW" }
  | { readonly type: "SIMULATION_COMPLETED"; readonly simulation: unknown }
  | {
      readonly type: "RECEIPT_CREATED";
      readonly receipt: ChangeReceipt;
      readonly expectedWorkflow: WorkflowState<TInput>;
      readonly [verifiedReceiptCommandBrand]: true;
    }
  | {
      readonly type: "RECEIPT_REJECTED";
      readonly expectedWorkflow: WorkflowState<TInput>;
      readonly [verifiedReceiptCommandBrand]: true;
    };

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
    transportError: null,
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

export function rebindReview<TInput>(
  source: InitialReviewControllerInput<TInput>,
): ReviewControllerCommand<TInput> {
  return { type: "REBIND_REVIEW", source };
}

export function approveReview(): ReviewControllerCommand {
  return { type: "APPROVE_REVIEW" };
}

export function rejectReview(): ReviewControllerCommand {
  return { type: "REJECT_REVIEW" };
}

export function completeReviewSimulation(
  simulation: unknown,
): ReviewControllerCommand {
  return { type: "SIMULATION_COMPLETED", simulation };
}

export async function recordReviewReceipt<TInput>(
  state: ReviewControllerState<TInput>,
  receipt: unknown,
): Promise<ReviewControllerCommand<TInput>> {
  if (!isReceiptPhase(state.workflow)) {
    throw new IllegalTransitionError(
      state.workflow.phase,
      "RECEIPT_CREATED",
    );
  }

  const parsed = ChangeReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    return rejectedReceiptCommand(state.workflow);
  }

  try {
    if (!(await receiptMatchesWorkflow(state, parsed.data))) {
      return rejectedReceiptCommand(state.workflow);
    }
  } catch {
    return rejectedReceiptCommand(state.workflow);
  }

  return {
    type: "RECEIPT_CREATED",
    receipt: parsed.data,
    expectedWorkflow: state.workflow,
    [verifiedReceiptCommandBrand]: true,
  };
}

export function reviewControllerReducer<TInput>(
  state: ReviewControllerState<TInput>,
  command: ReviewControllerCommand<TInput>,
): ReviewControllerState<TInput> {
  switch (command.type) {
    case "START_REVIEW": {
      const activeRequest = {
        attemptId: IdSchema.parse(command.attemptId),
      };
      return {
        ...state,
        review: null,
        transportError: null,
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

    case "REBIND_REVIEW": {
      const sourceId = IdSchema.parse(command.source.sourceId);
      const expectedInputId = IdSchema.parse(command.source.expectedInputId);
      const session = ReviewSessionEnvelopeSchema.parse(command.source.session);
      return {
        session,
        expectedInputId,
        workflow: transition(state.workflow, {
          type: "RESET",
          sourceId,
          input: command.source.input,
        }),
        review: null,
        transportError: null,
        activeRequest: null,
      };
    }

    case "APPROVE_REVIEW":
      return {
        ...state,
        workflow: transition(state.workflow, { type: "APPROVE" }),
      };

    case "REJECT_REVIEW":
      return {
        ...state,
        workflow: transition(state.workflow, { type: "REJECT" }),
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

    case "RECEIPT_CREATED":
      if (
        command[verifiedReceiptCommandBrand] !== true ||
        command.expectedWorkflow !== state.workflow
      ) {
        return state;
      }
      return {
        ...state,
        workflow: transition(state.workflow, {
          type: "RECEIPT_CREATED",
          receipt: command.receipt,
        }),
      };

    case "RECEIPT_REJECTED":
      if (
        command[verifiedReceiptCommandBrand] !== true ||
        command.expectedWorkflow !== state.workflow
      ) {
        return state;
      }
      return failSafely(state, SAFE_RECEIPT_ERROR_MESSAGE);

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
    const transportError = ReviewTransportErrorSchema.safeParse(payload);
    if (
      transportError.success &&
      transportErrorMatchesState(state, transportError.data.error)
    ) {
      return failWithTransportError(state, transportError.data.error);
    }
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
  return {
    ...state,
    workflow,
    review,
    transportError: null,
    activeRequest: null,
  };
}

function transportErrorMatchesState<TInput>(
  state: ReviewControllerState<TInput>,
  error: ReviewTransportErrorDetail,
): boolean {
  if (error.domainId !== null && error.domainId !== state.session.domainId) {
    return false;
  }
  return (
    !error.replayAvailable ||
    (error.replaySource.domainId === state.session.domainId &&
      error.replaySource.contractVersion === state.session.contractVersion &&
      error.replaySource.sourceId === state.workflow.sourceId)
  );
}

function failWithTransportError<TInput>(
  state: ReviewControllerState<TInput>,
  transportError: ReviewTransportErrorDetail,
): ReviewControllerState<TInput> {
  return {
    ...state,
    review: null,
    transportError,
    activeRequest: null,
    workflow: transition(state.workflow, {
      type: "FAIL",
      userMessage: transportError.message,
    }),
  };
}

function failSafely<TInput>(
  state: ReviewControllerState<TInput>,
  userMessage = SAFE_REVIEW_ERROR_MESSAGE,
): ReviewControllerState<TInput> {
  return {
    ...state,
    review: null,
    transportError: null,
    activeRequest: null,
    workflow: transition(state.workflow, {
      type: "FAIL",
      userMessage,
    }),
  };
}

type ReceiptWorkflow<TInput> = Extract<
  WorkflowState<TInput>,
  { phase: "BLOCKED" | "REJECTED" | "SIMULATED" }
>;

function isReceiptPhase<TInput>(
  workflow: WorkflowState<TInput>,
): workflow is ReceiptWorkflow<TInput> {
  return (
    workflow.phase === "BLOCKED" ||
    workflow.phase === "REJECTED" ||
    workflow.phase === "SIMULATED"
  );
}

function rejectedReceiptCommand<TInput>(
  expectedWorkflow: WorkflowState<TInput>,
): ReviewControllerCommand<TInput> {
  return {
    type: "RECEIPT_REJECTED",
    expectedWorkflow,
    [verifiedReceiptCommandBrand]: true,
  };
}

async function receiptMatchesWorkflow<TInput>(
  state: ReviewControllerState<TInput>,
  receipt: ChangeReceipt,
): Promise<boolean> {
  if (!isReceiptPhase(state.workflow)) {
    return false;
  }

  const workflow = state.workflow;
  const expectedDecision: ReceiptDecision =
    workflow.phase === "BLOCKED"
      ? "blocked"
      : workflow.phase === "REJECTED"
        ? "rejected"
        : "approved";
  const expectedSimulation =
    workflow.phase === "SIMULATED" ? workflow.simulation : null;
  const [inputSha256, proposalSha256, receiptHashValid] = await Promise.all([
    hashCanonical(workflow.input),
    hashCanonical(workflow.proposal),
    verifyReceiptHash(receipt),
  ]);

  return (
    receipt.sourceId === workflow.sourceId &&
    receipt.inputId === state.expectedInputId &&
    receipt.inputSha256 === inputSha256 &&
    receipt.proposalId === workflow.proposal.proposalId &&
    receipt.proposalSha256 === proposalSha256 &&
    canonicallyEqual(receipt.findings, workflow.findings) &&
    receipt.riskLevel === workflow.riskLevel &&
    receipt.mode === workflow.mode &&
    receipt.fixtureProvenance === workflow.provenance &&
    receipt.model === (state.review?.provenance.model ?? null) &&
    receipt.approver === null &&
    receipt.decision === expectedDecision &&
    canonicallyEqual(receipt.simulation, expectedSimulation) &&
    receiptHashValid
  );
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
