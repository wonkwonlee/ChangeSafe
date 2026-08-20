import { describe, expect, it } from "vitest";

import { POLICY_VERSION } from "@changesafe/domain-terraform";

import { POST as reviewPost } from "@/app/api/reviews/analyze/route";
import { TERRAFORM_REVIEW_EXAMPLES } from "@/features/domains/terraform/examples";
import { ReviewAnalyzeSuccessV1Schema } from "@/features/domains/review-api-contract";

function request(sourceId: string, contractVersion: string): Request {
  return new Request("http://localhost/api/reviews/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiVersion: "v1",
      domainId: "terraform",
      contractVersion,
      sourceId,
      analysisMode: "replay",
    }),
  });
}

describe("POST /api/reviews/analyze Terraform public replay", () => {
  it.each([
    ["scenario-k-capacity-scale-up", "LOW", false, "authored-synthetic"],
    ["scenario-j-destroy-protected", "CRITICAL", true, "authored-red-team"],
    ["scenario-p-injected-pr-context", "CRITICAL", true, "authored-red-team"],
    ["terraform-large-plan-boundary", "LOW", false, "authored-synthetic"],
  ] as const)(
    "evaluates %s as an external diff without a simulation or durable decision",
    async (sourceId, expectedRisk, expectedBlock, expectedProvenance) => {
      const descriptor = TERRAFORM_REVIEW_EXAMPLES.find(
        (example) => example.sourceId === sourceId,
      );
      expect(descriptor).toBeDefined();

      const response = await reviewPost(
        request(sourceId, descriptor!.contractVersion),
      );
      const payload = ReviewAnalyzeSuccessV1Schema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(payload.result).toMatchObject({
        domainId: "terraform",
        sourceId,
        riskLevel: expectedRisk,
        session: {
          contractVersion: descriptor!.contractVersion,
          policyVersion: POLICY_VERSION,
          domainShape: "external-diff",
          runtimeMode: "public-replay",
          source: "authored-fixture",
          analysisMode: "replay",
          provenance: expectedProvenance,
          capabilities: {
            sandboxSimulation: false,
            durableDecision: false,
          },
        },
        provenance: {
          classification: expectedProvenance,
          model: null,
          provider: null,
          fixtureId: sourceId,
        },
        effectCapability: { kind: "external-diff" },
      });
      expect(
        payload.result.findings.some((finding) => finding.status === "BLOCK"),
      ).toBe(expectedBlock);
      expect("simulate" in payload.result).toBe(false);
      expect("receipt" in payload.result).toBe(false);
      expect("decision" in payload.result).toBe(false);
    },
  );
});
