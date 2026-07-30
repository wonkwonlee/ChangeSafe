import { describe, expect, it, vi } from "vitest";

import {
  SelfHostedReviewTransportError,
  createSelfHostedReviewTransport,
} from "@/features/reviews/selfHostedReviewTransport";

describe("self-hosted review transport", () => {
  it("accepts only credential-free HTTP(S) base URLs", () => {
    expect(() => createSelfHostedReviewTransport("https://review.example.test")).not.toThrow();
    for (const rejected of [
      "javascript:alert(1)",
      "https://user:secret@review.example.test",
      "https://review.example.test?token=secret",
      "https://review.example.test#secret",
    ]) {
      expect(() => createSelfHostedReviewTransport(rejected)).toThrow();
    }
  });

  it("uses only cookie credentials and never adds a bearer credential", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ reviews: [] }),
    );
    const transport = createSelfHostedReviewTransport(
      "https://review.example.test/",
      fetchImpl,
    );

    await expect(transport.list()).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://review.example.test/reviews",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
      }),
    );
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toBeUndefined();
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("authorization");
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("bearer");
  });

  it("submits only human intent to a durable decision route", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: "ILLEGAL_TRANSITION", message: "Blocked by policy." } },
        { status: 409 },
      ),
    );
    const transport = createSelfHostedReviewTransport(
      "https://review.example.test",
      fetchImpl,
    );

    await expect(transport.decide("review-safe-one", "approve")).rejects.toMatchObject({
      status: 409,
      code: "ILLEGAL_TRANSITION",
    } satisfies Partial<SelfHostedReviewTransportError>);
    const request = fetchImpl.mock.calls[0];
    expect(request?.[0]).toBe(
      "https://review.example.test/reviews/review-safe-one/decisions",
    );
    expect(request?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
      credentials: "include",
    });
    expect(request?.[1]?.body).not.toContain("findings");
    expect(request?.[1]?.body).not.toContain("risk");
    expect(request?.[1]?.body).not.toContain("receipt");
  });

  it("distinguishes a pending receipt from a failed proof request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "ILLEGAL_TRANSITION",
            message: "The requested review does not have an immutable resolution.",
          },
        },
        { status: 409 },
      ),
    );
    const transport = createSelfHostedReviewTransport(
      "https://review.example.test",
      fetchImpl,
    );

    await expect(transport.getReceiptProof("review-pending")).resolves.toEqual({
      status: "pending",
    });
  });
});
