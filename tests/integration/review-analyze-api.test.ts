import { describe, expect, it, vi } from "vitest";
import { POLICY_VERSION } from "@changesafe/domain-network";

import { POST as legacyPost } from "@/app/api/analyze/route";
import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import {
  AnalyzeSuccessSchema,
  ReviewAnalyzeErrorV1Schema,
  ReviewAnalyzeSuccessV1Schema,
} from "@/lib/domain/api";
import { REVIEW_CONTRACT_VERSION } from "@/features/domains/review-contract";

function request(body: unknown): Request {
  return new Request("http://localhost/api/reviews/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function v1Request(
  sourceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    apiVersion: "v1",
    domainId: "network",
    contractVersion: REVIEW_CONTRACT_VERSION,
    sourceId,
    analysisMode: "replay",
    ...overrides,
  };
}

describe("POST /api/reviews/analyze bundled Network replay", () => {
  it.each([
    ["scenario-a-failover", "LOW", false, "bundled-replay"],
    ["scenario-b-route-leak", "CRITICAL", true, "authored-fixture"],
  ] as const)(
    "matches legacy proposal output and computes the %s deterministic outcome",
    async (sourceId, expectedRisk, expectedBlock, expectedSource) => {
      vi.stubEnv("OPENAI_API_KEY", "");
      const [legacyResponse, response] = await Promise.all([
        legacyPost(
          new Request("http://localhost/api/analyze", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scenarioId: sourceId, mode: "replay" }),
          }),
        ),
        reviewPost(request(v1Request(sourceId))),
      ]);

      expect(legacyResponse.status).toBe(200);
      expect(response.status).toBe(200);
      const legacy = AnalyzeSuccessSchema.parse(await legacyResponse.json());
      const payload = ReviewAnalyzeSuccessV1Schema.parse(await response.json());

      expect(payload.result.proposal).toEqual(legacy.proposal);
      expect(payload.result.riskLevel).toBe(expectedRisk);
      expect(
        payload.result.findings.some((finding) => finding.status === "BLOCK"),
      ).toBe(expectedBlock);
      expect(payload.result).toMatchObject({
        ok: true,
        domainId: "network",
        sourceId,
        session: {
          policyVersion: POLICY_VERSION,
          source: expectedSource,
          analysisMode: "replay",
          runtimeMode: "public-replay",
        },
        effectCapability: { kind: "sandbox-simulation" },
      });
    },
  );

  it("returns a safe unknown-domain envelope", async () => {
    const response = await reviewPost(
      request(v1Request("scenario-a-failover", { domainId: "future-domain" })),
    );
    const text = await response.text();
    const payload = ReviewAnalyzeErrorV1Schema.parse(JSON.parse(text));

    expect(response.status).toBe(404);
    expect(payload.result.error).toMatchObject({
      code: "UNKNOWN_DOMAIN",
      domainId: "future-domain",
      replayAvailable: false,
    });
    expect(text).not.toMatch(/stack|api[_-]?key|bearer|sk-/i);
  });

  it("returns a safe contract-version mismatch envelope", async () => {
    const response = await reviewPost(
      request(v1Request("scenario-a-failover", { contractVersion: "1.0.0" })),
    );
    const payload = ReviewAnalyzeErrorV1Schema.parse(await response.json());

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      apiVersion: "v1",
      result: {
        error: {
          code: "CONTRACT_VERSION_MISMATCH",
          domainId: "network",
          expectedContractVersion: REVIEW_CONTRACT_VERSION,
          receivedContractVersion: "1.0.0",
        },
      },
    });
  });

  it.each([
    ["client provenance", { provenance: "captured-replay" }],
    ["client source classification", { source: "bundled-replay" }],
    ["unknown key", { internal: true }],
    ["malformed domain", { domainId: "INVALID" }],
    ["unknown API version", { apiVersion: "v2" }],
  ])("rejects %s without accepting client authority", async (_label, extra) => {
    const response = await reviewPost(
      request(v1Request("scenario-a-failover", extra)),
    );
    const payload = ReviewAnalyzeErrorV1Schema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(payload.result.error.code).toBe("REQUEST_INVALID");
    expect(payload.result.error.replayAvailable).toBe(false);
  });

  it("rejects non-replay analysis without reaching a provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret-route-must-never-read");
    const response = await reviewPost(
      request(
        v1Request("scenario-a-failover", {
          analysisMode: "live",
        }),
      ),
    );
    const text = await response.text();
    const payload = ReviewAnalyzeErrorV1Schema.parse(JSON.parse(text));

    expect(response.status).toBe(503);
    expect(payload.result.error).toMatchObject({
      code: "ANALYSIS_UNAVAILABLE",
      replayAvailable: true,
      replaySource: {
        domainId: "network",
        contractVersion: REVIEW_CONTRACT_VERSION,
        sourceId: "scenario-a-failover",
      },
    });
    expect(text).not.toContain("test-secret-route-must-never-read");
  });

  it.each([
    [
      "an unknown bundled source",
      v1Request("scenario-ghost"),
      404,
      "SOURCE_UNKNOWN",
    ],
    [
      "a non-Network domain",
      v1Request("scenario-a-failover", { domainId: "terraform" }),
      404,
      "SOURCE_UNKNOWN",
    ],
  ] as const)("rejects %s", async (_label, body, status, code) => {
    const response = await reviewPost(request(body));
    const payload = ReviewAnalyzeErrorV1Schema.parse(await response.json());

    expect(response.status).toBe(status);
    expect(payload.result.error.code).toBe(code);
    expect(payload.result.error.replayAvailable).toBe(false);
  });

  it("rejects malformed and oversized JSON with safe bounded errors", async () => {
    const malformed = await reviewPost(request("{"));
    expect(malformed.status).toBe(400);
    expect(
      ReviewAnalyzeErrorV1Schema.parse(await malformed.json()).result.error
        .code,
    ).toBe("REQUEST_INVALID");

    const oversized = await reviewPost(
      request(
        v1Request("scenario-a-failover", {
          padding: "x".repeat(8192),
        }),
      ),
    );
    expect(oversized.status).toBe(413);
    expect(
      ReviewAnalyzeErrorV1Schema.parse(await oversized.json()).result.error
        .code,
    ).toBe("REQUEST_INVALID");
  });
});
