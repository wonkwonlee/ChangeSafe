import { describe, expect, it } from "vitest";

import { POLICY_VERSION } from "@changesafe/domain-kubernetes/offline";

import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import { KUBERNETES_REVIEW_EXAMPLES } from "@/features/domains/kubernetes/examples";
import {
  KUBERNETES_UNSUPPORTED_PUBLIC_REPLAY_SOURCE,
} from "@/features/domains/kubernetes/fixtures";
import {
  ReviewAnalyzeErrorV1Schema,
  ReviewAnalyzeSuccessV1Schema,
} from "@/features/domains/review-api-contract";

function request(sourceId: string, contractVersion: string): Request {
  return new Request("http://localhost/api/reviews/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiVersion: "v1",
      domainId: "kubernetes",
      contractVersion,
      sourceId,
      analysisMode: "replay",
    }),
  });
}

describe("POST /api/reviews/analyze Kubernetes public replay", () => {
  it.each([
    ["scenario-q-safe-scale-up", "LOW", false, "authored-synthetic"],
    ["scenario-r-partial-replica-reduction", "MEDIUM", false, "authored-synthetic"],
    ["scenario-w-mutable-image-tag", "HIGH", false, "authored-synthetic"],
    ["scenario-m-selector-drift", "CRITICAL", true, "authored-synthetic"],
    ["scenario-v-protected-config-change", "CRITICAL", true, "authored-synthetic"],
  ] as const)(
    "evaluates %s as an offline simulated-state replay without decision authority",
    async (sourceId, expectedRisk, expectedBlock, expectedProvenance) => {
      const descriptor = KUBERNETES_REVIEW_EXAMPLES.find(
        (example) => example.sourceId === sourceId,
      );
      expect(descriptor).toBeDefined();

      const response = await reviewPost(
        request(sourceId, descriptor!.contractVersion),
      );
      const payload = ReviewAnalyzeSuccessV1Schema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(payload.result).toMatchObject({
        domainId: "kubernetes",
        sourceId,
        riskLevel: expectedRisk,
        session: {
          contractVersion: descriptor!.contractVersion,
          policyVersion: POLICY_VERSION,
          domainShape: "simulated-state",
          runtimeMode: "public-replay",
          source: "authored-fixture",
          analysisMode: "replay",
          provenance: expectedProvenance,
          capabilities: {
            sandboxSimulation: true,
            durableDecision: false,
          },
        },
        provenance: {
          classification: expectedProvenance,
          model: null,
          provider: null,
          fixtureId: sourceId,
        },
        effectCapability: { kind: "sandbox-simulation" },
      });
      expect(
        payload.result.findings.some((finding) => finding.status === "BLOCK"),
      ).toBe(expectedBlock);
      expect("simulate" in payload.result).toBe(false);
      expect("receipt" in payload.result).toBe(false);
      expect("decision" in payload.result).toBe(false);
    },
  );

  it("rejects the known unsupported Secret source before accepting a result", async () => {
    const response = await reviewPost(
      request(
        KUBERNETES_UNSUPPORTED_PUBLIC_REPLAY_SOURCE.sourceId,
        KUBERNETES_REVIEW_EXAMPLES[0]!.contractVersion,
      ),
    );
    const payload = ReviewAnalyzeErrorV1Schema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(payload.result.error).toMatchObject({
      code: "INPUT_INVALID",
      domainId: "kubernetes",
      replayAvailable: false,
    });
    expect(payload.result).not.toHaveProperty("proposal");
    expect(payload.result).not.toHaveProperty("findings");
    expect(payload.result).not.toHaveProperty("effectCapability");
  });
});
