import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import type {
  ReviewAnalysisResult,
  ReviewSessionEnvelope,
} from "@/features/domains/review-contract";
import { receiveReviewTransport } from "@/features/reviews/controller";
import {
  useReviewController,
  type ReviewTransport,
  type ReviewTransportResult,
  type UseReviewControllerOptions,
  type UseReviewControllerResult,
} from "@/features/reviews/useReviewController";
import { ReviewAnalyzeSuccessV1Schema } from "@/lib/domain/api";

const reactHarness = vi.hoisted(() => {
  const unset = Symbol("unset");
  let currentState: unknown | typeof unset = unset;
  let currentReducer:
    | ((state: unknown, command: unknown) => unknown)
    | null = null;
  let refIndex = 0;
  let refs: Array<{ current: unknown }> = [];
  let effectIndex = 0;
  let effectCleanups: Array<(() => void) | undefined> = [];

  function dispatch(command: unknown) {
    if (currentReducer === null || currentState === unset) {
      throw new Error("review reducer is not initialized");
    }
    currentState = currentReducer(currentState, command);
  }

  return {
    reset() {
      currentState = unset;
      currentReducer = null;
      refIndex = 0;
      refs = [];
      effectIndex = 0;
      effectCleanups = [];
    },
    beginRender() {
      refIndex = 0;
      effectIndex = 0;
    },
    cleanup() {
      effectCleanups.forEach((cleanup) => {
        cleanup?.();
      });
    },
    dispatch,
    useReducer(
      reducer: (state: unknown, command: unknown) => unknown,
      initialArg: unknown,
      initializer?: (arg: unknown) => unknown,
    ) {
      if (currentState === unset) {
        currentState = initializer ? initializer(initialArg) : initialArg;
      }
      currentReducer = reducer;
      return [currentState, dispatch] as const;
    },
    useRef(initialValue: unknown) {
      const index = refIndex;
      refIndex += 1;
      const existing = refs[index];
      if (existing) {
        return existing;
      }
      const created = { current: initialValue };
      refs[index] = created;
      return created;
    },
    useCallback<TCallback>(callback: TCallback) {
      return callback;
    },
    useEffect(effect: () => void | (() => void)) {
      const index = effectIndex;
      effectIndex += 1;
      const cleanup = effect();
      effectCleanups[index] =
        typeof cleanup === "function" ? cleanup : undefined;
    },
  };
});

vi.mock("react", () => ({
  useCallback: reactHarness.useCallback,
  useEffect: reactHarness.useEffect,
  useReducer: reactHarness.useReducer,
  useRef: reactHarness.useRef,
}));

const input = {
  incidentId: "incident-one",
  alert: "Link instability",
};

const session: ReviewSessionEnvelope = {
  domainId: "network",
  contractVersion: "1.0.0",
  domainShape: "simulated-state",
  capabilities: {
    sandboxSimulation: true,
    resourceGraph: true,
    structuredDiff: true,
    untrustedContext: true,
    durableDecision: false,
  },
  runtimeMode: "public-replay",
  source: "bundled-replay",
  analysisMode: "replay",
  provenance: "captured-replay",
};

async function validReview(): Promise<ReviewAnalysisResult> {
  const response = await reviewPost(
    new Request("http://localhost/api/reviews/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: "v1",
        domainId: "network",
        contractVersion: "1.0.0",
        sourceId: "scenario-a-failover",
        analysisMode: "replay",
      }),
    }),
  );
  return ReviewAnalyzeSuccessV1Schema.parse(await response.json()).result;
}

function useRenderedController<TInput>(
  options: UseReviewControllerOptions<TInput>,
): UseReviewControllerResult<TInput> {
  reactHarness.beginRender();
  return useReviewController(options);
}

beforeEach(() => {
  reactHarness.reset();
});

describe("useReviewController", () => {
  it("delegates transport results and workflow authority to the pure reducer", async () => {
    const payload = await validReview();
    const transport = vi.fn<ReviewTransport<typeof payload.input>>(
      async (request) => ({
        attemptId: request.attemptId,
        payload,
      }),
    );
    const options = {
      sourceId: "scenario-a-failover",
      input: payload.input,
      expectedInputId: payload.inputId,
      session: payload.session,
      transport,
      attemptIdFactory: () => "attempt-one",
    };
    let hook = useRenderedController(options);

    expect(hook.state.workflow.phase).toBe("READY");
    hook = useRenderedController({
      ...options,
      expectedInputId: "incident-other",
    });
    await hook.analyze();
    hook = useRenderedController(options);

    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      attemptId: "attempt-one",
      sourceId: "scenario-a-failover",
      expectedInputId: "inc-uplink-degraded-4821",
      session: payload.session,
    });
    expect(hook.state.workflow.phase).toBe("APPROVAL_REQUIRED");
    expect(hook.state.review).toMatchObject({
      sourceId: "scenario-a-failover",
      inputId: "inc-uplink-degraded-4821",
    });

    hook.approve();
    hook = useRenderedController(options);
    expect(hook.state.workflow.phase).toBe("APPROVED");
  });

  it("fails the current attempt safely when transport returns a mismatched attempt id", async () => {
    const payload = await validReview();
    const attemptIds = ["attempt-one", "attempt-two"];
    let attemptIndex = 0;
    const transport = vi
      .fn<ReviewTransport<typeof payload.input>>()
      .mockResolvedValueOnce({
        attemptId: "attempt-one",
        payload: { malformed: true },
      })
      .mockResolvedValueOnce({
        attemptId: "attempt-one",
        payload,
      });
    const options = {
      sourceId: "scenario-a-failover",
      input: payload.input,
      expectedInputId: payload.inputId,
      session: payload.session,
      transport,
      attemptIdFactory: () => {
        const attemptId = attemptIds[attemptIndex];
        attemptIndex += 1;
        if (!attemptId) {
          throw new Error("unexpected extra attempt");
        }
        return attemptId;
      },
    };
    let hook = useRenderedController(options);

    await hook.analyze();
    hook = useRenderedController(options);
    expect(hook.state.workflow.phase).toBe("ERROR");

    await hook.analyze();
    hook = useRenderedController(options);

    expect(transport).toHaveBeenCalledTimes(2);
    expect(hook.state.workflow.phase).toBe("ERROR");
    expect(hook.state.activeRequest).toBeNull();
    expect(hook.state.review).toBeNull();
  });

  it("ignores a genuinely late older transport promise after a retry starts", async () => {
    const payload = await validReview();
    let resolveFirst: ((result: ReviewTransportResult) => void) | undefined;
    let resolveSecond: ((result: ReviewTransportResult) => void) | undefined;
    const transport = vi
      .fn<ReviewTransport<typeof payload.input>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const attemptIds = ["attempt-one", "attempt-two"];
    let attemptIndex = 0;
    const options = {
      sourceId: "scenario-a-failover",
      input: payload.input,
      expectedInputId: payload.inputId,
      session: payload.session,
      transport,
      attemptIdFactory: () => {
        const attemptId = attemptIds[attemptIndex];
        attemptIndex += 1;
        if (!attemptId) {
          throw new Error("unexpected extra attempt");
        }
        return attemptId;
      },
    };
    let hook = useRenderedController(options);
    const firstAnalysis = hook.analyze();
    hook = useRenderedController(options);
    expect(hook.state.activeRequest).toEqual({ attemptId: "attempt-one" });

    reactHarness.dispatch(
      receiveReviewTransport("attempt-one", { malformed: true }),
    );
    hook = useRenderedController(options);
    expect(hook.state.workflow.phase).toBe("ERROR");

    const secondAnalysis = hook.analyze();
    hook = useRenderedController(options);
    expect(hook.state.activeRequest).toEqual({ attemptId: "attempt-two" });

    resolveFirst?.({ attemptId: "attempt-one", payload });
    await firstAnalysis;
    hook = useRenderedController(options);

    expect(hook.state.workflow.phase).toBe("ANALYZING");
    expect(hook.state.activeRequest).toEqual({ attemptId: "attempt-two" });
    expect(hook.state.review).toBeNull();

    resolveSecond?.({ attemptId: "attempt-two", payload });
    await secondAnalysis;
    hook = useRenderedController(options);
    expect(hook.state.workflow.phase).toBe("APPROVAL_REQUIRED");
  });

  it("does not invoke transport when core rejects the current phase", async () => {
    const payload = await validReview();
    const transport = vi.fn<ReviewTransport<typeof payload.input>>(
      async (request) => ({
        attemptId: request.attemptId,
        payload,
      }),
    );
    const options = {
      sourceId: "scenario-a-failover",
      input: payload.input,
      expectedInputId: payload.inputId,
      session: payload.session,
      transport,
      attemptIdFactory: () => "attempt-one",
    };
    let hook = useRenderedController(options);
    await hook.analyze();
    hook = useRenderedController(options);
    expect(hook.state.workflow.phase).toBe("APPROVAL_REQUIRED");

    await hook.analyze();

    expect(transport).toHaveBeenCalledOnce();
  });

  it("aborts pending transport and ignores settlement after cleanup", async () => {
    let resolveTransport: ((result: ReviewTransportResult) => void) | undefined;
    let signal: AbortSignal | undefined;
    const transport = vi.fn<ReviewTransport<typeof input>>(
      (request) =>
        new Promise((resolve) => {
          signal = request.signal;
          resolveTransport = resolve;
        }),
    );
    const options = {
      sourceId: "scenario-one",
      input,
      expectedInputId: input.incidentId,
      session,
      transport,
      attemptIdFactory: () => "attempt-one",
    };
    let hook = useRenderedController(options);
    const analysis = hook.analyze();
    hook = useRenderedController(options);
    expect(hook.state.workflow.phase).toBe("ANALYZING");

    reactHarness.cleanup();
    expect(signal?.aborted).toBe(true);
    resolveTransport?.({
      attemptId: "attempt-one",
      payload: { malformed: true },
    });
    await analysis;
    hook = useRenderedController(options);

    expect(hook.state.workflow.phase).toBe("ANALYZING");
  });
});
