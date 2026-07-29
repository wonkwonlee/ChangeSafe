import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import { publicReplayTransport } from "@/features/reviews/publicReplayTransport";
import type { ReviewTransportRequest } from "@/features/reviews/useReviewController";
import {
  ReviewAnalyzeErrorV1Schema,
  ReviewAnalyzeSuccessV1Schema,
  type ReviewAnalyzeSuccessV1,
} from "@/features/domains/review-api-contract";

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function validSuccessWrapper(): Promise<ReviewAnalyzeSuccessV1> {
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
  return ReviewAnalyzeSuccessV1Schema.parse(await response.json());
}

function transportRequest(
  wrapper: ReviewAnalyzeSuccessV1,
  signal = new AbortController().signal,
): ReviewTransportRequest<ReviewAnalyzeSuccessV1["result"]["input"]> {
  return {
    attemptId: "attempt-local",
    sourceId: wrapper.result.sourceId,
    expectedInputId: wrapper.result.inputId,
    input: wrapper.result.input,
    session: wrapper.result.session,
    signal,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publicReplayTransport", () => {
  it("posts the exact V1 replay request and returns the validated success result", async () => {
    const wrapper = await validSuccessWrapper();
    const fetchMock = vi.fn<FetchImplementation>(
      async () => Response.json(wrapper),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = transportRequest(wrapper);

    const result = await publicReplayTransport(request);

    expect(result).toEqual({
      attemptId: "attempt-local",
      payload: wrapper.result,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/reviews/analyze");
    expect(init).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: "v1",
        domainId: "network",
        contractVersion: "1.0.0",
        sourceId: "scenario-a-failover",
        analysisMode: "replay",
      }),
      signal: request.signal,
    });
    expect(init).not.toHaveProperty("credentials");
  });

  it("returns validated transport error and replay metadata", async () => {
    const success = await validSuccessWrapper();
    const wrapper = ReviewAnalyzeErrorV1Schema.parse({
      apiVersion: "v1",
      result: {
        ok: false,
        contractVersion: "1.0.0",
        error: {
          code: "ANALYSIS_UNAVAILABLE",
          message: "Replay remains available.",
          domainId: "network",
          replayAvailable: true,
          replaySource: {
            domainId: "network",
            contractVersion: "1.0.0",
            sourceId: "scenario-a-failover",
          },
          expectedContractVersion: null,
          receivedContractVersion: null,
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchImplementation>(
        async () => Response.json(wrapper, { status: 503 }),
      ),
    );

    const result = await publicReplayTransport(transportRequest(success));

    expect(result).toEqual({
      attemptId: "attempt-local",
      payload: {
        ok: false,
        contractVersion: "1.0.0",
        error: {
          code: "ANALYSIS_UNAVAILABLE",
          message: "Replay remains available.",
          domainId: "network",
          replayAvailable: true,
          replaySource: {
            domainId: "network",
            contractVersion: "1.0.0",
            sourceId: "scenario-a-failover",
          },
          expectedContractVersion: null,
          receivedContractVersion: null,
        },
      },
    });
  });

  it("rejects a malformed wrapper that tries to supply transport identity", async () => {
    const wrapper = await validSuccessWrapper();
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchImplementation>(async () =>
        Response.json({
          ...wrapper,
          attemptId: "attempt-forged",
        }),
      ),
    );

    await expect(
      publicReplayTransport(transportRequest(wrapper)),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("forwards abort to the only fetch request", async () => {
    const wrapper = await validSuccessWrapper();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null = null;
    const fetchMock = vi.fn<FetchImplementation>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          receivedSignal = init?.signal ?? null;
          receivedSignal?.addEventListener(
            "abort",
            () => reject(receivedSignal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = publicReplayTransport(
      transportRequest(wrapper, controller.signal),
    );
    controller.abort(new DOMException("Cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal).toBe(controller.signal);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
