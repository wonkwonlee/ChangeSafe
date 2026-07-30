"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { IllegalTransitionError } from "@changesafe/core";

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
  type InitialReviewControllerInput,
  type ReviewControllerCommand,
  type ReviewControllerState,
} from "./controller";
import type {
  ReviewSessionEnvelope,
  ReviewTransportErrorDetail,
} from "../domains/review-contract";

export interface ReviewTransportRequest<TInput> {
  readonly attemptId: string;
  readonly sourceId: string;
  readonly expectedInputId: string;
  readonly input: TInput;
  readonly session: ReviewSessionEnvelope;
  readonly signal: AbortSignal;
}

export interface ReviewTransportResult {
  readonly attemptId: string;
  readonly payload: unknown;
}

export type ReviewTransport<TInput> = (
  request: ReviewTransportRequest<TInput>,
) => Promise<ReviewTransportResult>;

export type ReviewAttemptIdFactory = () => string;

export interface UseReviewControllerOptions<TInput>
  extends InitialReviewControllerInput<TInput> {
  readonly transport: ReviewTransport<TInput>;
  readonly attemptIdFactory?: ReviewAttemptIdFactory;
}

export interface UseReviewControllerResult<TInput> {
  readonly state: ReviewControllerState<TInput>;
  readonly transportError: ReviewTransportErrorDetail | null;
  analyze(): Promise<void>;
  rebind(source: InitialReviewControllerInput<TInput>): void;
  approve(): void;
  reject(): void;
  completeSimulation(simulation: unknown): void;
  recordReceipt(receipt: unknown): Promise<void>;
}

let nextAttemptSequence = 0n;

function createAttemptId(): string {
  nextAttemptSequence += 1n;
  return `attempt-${nextAttemptSequence.toString(36)}`;
}

function reducer<TInput>(
  state: ReviewControllerState<TInput>,
  command: ReviewControllerCommand<TInput>,
): ReviewControllerState<TInput> {
  return reviewControllerReducer(state, command);
}

export function useReviewController<TInput>(
  options: UseReviewControllerOptions<TInput>,
): UseReviewControllerResult<TInput> {
  const initialInput: InitialReviewControllerInput<TInput> = {
    sourceId: options.sourceId,
    input: options.input,
    expectedInputId: options.expectedInputId,
    session: options.session,
  };
  const [state, reactDispatch] = useReducer(
    reducer<TInput>,
    initialInput,
    initialReviewControllerState<TInput>,
  );
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const controllersRef = useRef(new Set<AbortController>());
  const transportRef = useRef(options.transport);
  const attemptIdFactoryRef = useRef(
    options.attemptIdFactory ?? createAttemptId,
  );

  useEffect(() => {
    stateRef.current = state;
    transportRef.current = options.transport;
    attemptIdFactoryRef.current =
      options.attemptIdFactory ?? createAttemptId;
  }, [options.attemptIdFactory, options.transport, state]);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      controllers.forEach((controller) => {
        controller.abort();
      });
      controllers.clear();
    };
  }, []);

  const applyCommand = useCallback(
    (command: ReviewControllerCommand<TInput>) => {
      const nextState = reviewControllerReducer(
        stateRef.current,
        command,
      );
      stateRef.current = nextState;
      reactDispatch(command);
      return nextState;
    },
    [reactDispatch],
  );

  const analyze = useCallback(async () => {
    const attemptId = attemptIdFactoryRef.current();
    try {
      applyCommand(startReview(attemptId));
    } catch (error) {
      if (error instanceof IllegalTransitionError) {
        return;
      }
      throw error;
    }

    const controller = new AbortController();
    controllersRef.current.add(controller);
    const requestState = stateRef.current;

    try {
      const result = await transportRef.current({
        attemptId,
        sourceId: requestState.workflow.sourceId,
        expectedInputId: requestState.expectedInputId,
        input: requestState.workflow.input,
        session: requestState.session,
        signal: controller.signal,
      });
      if (!mountedRef.current) {
        return;
      }
      applyCommand(
        receiveReviewTransport(
          attemptId,
          result.attemptId === attemptId ? result.payload : null,
        ),
      );
    } catch {
      if (!mountedRef.current || controller.signal.aborted) {
        return;
      }
      applyCommand(receiveReviewTransport(attemptId, null));
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [applyCommand]);

  const approve = useCallback(() => {
    applyCommand(approveReview());
  }, [applyCommand]);

  const rebind = useCallback(
    (source: InitialReviewControllerInput<TInput>) => {
      const command = rebindReview(source);
      // The reducer is pure: validate the complete replacement before an
      // invalid rebind can cancel work that still belongs to the active review.
      reviewControllerReducer(stateRef.current, command);
      controllersRef.current.forEach((controller) => {
        controller.abort();
      });
      controllersRef.current.clear();
      applyCommand(command);
    },
    [applyCommand],
  );

  const reject = useCallback(() => {
    applyCommand(rejectReview());
  }, [applyCommand]);

  const completeSimulation = useCallback(
    (simulation: unknown) => {
      applyCommand(completeReviewSimulation(simulation));
    },
    [applyCommand],
  );

  const recordReceipt = useCallback(
    async (receipt: unknown) => {
      const command = await recordReviewReceipt(stateRef.current, receipt);
      if (!mountedRef.current) {
        return;
      }
      applyCommand(command);
    },
    [applyCommand],
  );

  return {
    state,
    transportError: state.transportError,
    analyze,
    rebind,
    approve,
    reject,
    completeSimulation,
    recordReceipt,
  };
}
