import { describe, expect, it, vi } from "vitest";

import {
  SelfHostedReviewTransportError,
  createSelfHostedReviewTransport,
} from "@/features/reviews/selfHostedReviewTransport";

describe("self-hosted review transport", () => {
  it("requires HTTPS except for exact loopback development URLs", () => {
    expect(() => createSelfHostedReviewTransport("https://review.example.test")).not.toThrow();
    for (const accepted of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(() => createSelfHostedReviewTransport(accepted)).not.toThrow();
    }
    for (const rejected of [
      "javascript:alert(1)",
      "http://review.example.test",
      "http://localhost.example.test",
      "http://127.0.0.2:3000",
      "https://user:secret@review.example.test",
      "https://review.example.test?token=secret",
      "https://review.example.test#secret",
    ]) {
      expect(() => createSelfHostedReviewTransport(rejected)).toThrow();
    }
  });

  it("rejects remote cleartext before any credentialed request", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() =>
      createSelfHostedReviewTransport("http://review.example.test", fetchImpl),
    ).toThrow("HTTPS");
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("accepts the receipt decision values returned by the server", async () => {
    const response = {
      receiptId: "receipt-123",
      decision: "approved",
      riskLevel: "LOW",
      approver: {
        subject: "subject-123",
        issuer: "https://issuer.example.test",
        email: "approver@example.test",
      },
      ledgerSeq: 1,
      chainSha256: "a".repeat(64),
      record: {
        receipt: {
          receiptId: "receipt-123",
          sourceId: "source-123",
          inputId: "input-123",
          inputSha256: "b".repeat(64),
          proposalId: "proposal-123",
          proposalSha256: "c".repeat(64),
          appVersion: "0.1.0",
          policyVersion: "policy-v1",
          mode: "offline",
          model: null,
          fixtureProvenance: null,
          findings: [{
            policyId: "PATCH_SCHEMA",
            status: "PASS",
            title: "Patch is valid",
            explanation: "The patch is valid.",
            affectedResources: [],
            remediation: null,
          }],
          riskLevel: "LOW",
          decision: "approved",
          approver: {
            subject: "subject-123",
            issuer: "https://issuer.example.test",
            email: "approver@example.test",
          },
          simulation: {
            status: "completed",
            changedResourceIds: ["resource-1"],
            diff: [{ op: "replace", path: "/resource-1/value", before: null, after: true }],
            safetyProperties: [{
              propertyId: "property-1",
              satisfied: true,
              detail: "The property remains satisfied.",
            }],
            summary: "Simulation completed.",
          },
          createdAtUtc: "2026-07-30T00:00:00.000Z",
          receiptSha256: "d".repeat(64),
        },
        signature: {
          algorithm: "ed25519",
          publicKeyId: "e".repeat(32),
          signature: "A".repeat(86) + "==",
          signedAtUtc: "2026-07-30T00:00:00.000Z",
        },
      },
      resolution: {
        seq: 1,
        reviewId: "review-safe-one",
        resolvedAtUtc: "2026-07-30T00:00:00.000Z",
        receiptId: "receipt-123",
        receiptSha256: "d".repeat(64),
        claimBinding: "verified-claim",
        resolution: {
          resolutionVersion: "1",
          reviewId: "review-safe-one",
          resolvedAtUtc: "2026-07-30T00:00:00.000Z",
          receipt: {
            receiptId: "receipt-123",
            sourceId: "source-123",
            inputId: "input-123",
            inputSha256: "b".repeat(64),
            proposalId: "proposal-123",
            proposalSha256: "c".repeat(64),
            policyVersion: "policy-v1",
            receiptSha256: "d".repeat(64),
          },
        },
      },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    const transport = createSelfHostedReviewTransport(
      "https://review.example.test",
      fetchImpl,
    );

    await expect(transport.decide("review-safe-one", "approve")).resolves.toMatchObject({
      decision: "approved",
    });
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
