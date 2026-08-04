import { describe, expect, it } from "vitest";

import { deriveProposal, normalizePlan } from "@changesafe/domain-terraform";

import {
  LARGE_TERRAFORM_CHANGE_COUNT,
  TERRAFORM_PUBLIC_REPLAY_FIXTURES,
} from "@/features/domains/terraform/fixtures";
import { INJECTED_PULL_REQUEST_BODY } from "@/features/domains/terraform/injected-pr-body";
import {
  TERRAFORM_REVIEW_EXAMPLES,
} from "@/features/domains/terraform/examples";
import {
  REVIEW_CONTRACT_VERSION,
  ReviewExampleDescriptorSchema,
} from "@/features/domains/review-contract";

describe("Terraform review examples", () => {
  it("publishes each fictional public replay fixture exactly once", () => {
    const ids = TERRAFORM_REVIEW_EXAMPLES.map((example) => example.sourceId);

    expect(ids).toEqual([
      "terraform-safe-scale-up",
      "terraform-destroys-database",
      "terraform-protected-and-injected",
      "terraform-large-plan-boundary",
      "scenario-p-injected-pr-context",
    ]);
    expect(new Set(ids).size).toBe(5);
    expect(TERRAFORM_PUBLIC_REPLAY_FIXTURES.map((fixture) => fixture.sourceId)).toEqual(ids);
  });

  it("uses valid external-diff public replay descriptors with no durable decision", () => {
    for (const descriptor of TERRAFORM_REVIEW_EXAMPLES) {
      expect(ReviewExampleDescriptorSchema.parse(descriptor)).toEqual(descriptor);
      expect(descriptor).toMatchObject({
        domainId: "terraform",
        contractVersion: REVIEW_CONTRACT_VERSION,
        session: {
          domainId: "terraform",
          contractVersion: REVIEW_CONTRACT_VERSION,
          domainShape: "external-diff",
          runtimeMode: "public-replay",
          analysisMode: "replay",
          capabilities: {
            sandboxSimulation: false,
            resourceGraph: false,
            structuredDiff: true,
            untrustedContext: true,
            durableDecision: false,
          },
        },
      });
    }
  });

  it("derives its normalized input and proposal solely from the bundled fictional plan fixtures", () => {
    for (const fixture of TERRAFORM_PUBLIC_REPLAY_FIXTURES) {
      const input = normalizePlan(fixture.plan, {
        planId: fixture.inputId,
        context: [...fixture.context],
      });
      const proposal = deriveProposal(input);

      expect(input.planId).toBe(fixture.inputId);
      expect(proposal.proposalId).toBe("prop-terraform-plan");
      expect(proposal.operations).toHaveLength(input.changes.length);
      expect(proposal.operations.flatMap((operation) => operation.evidenceIds)).toEqual(
        input.changes.map((change) => change.evidenceId),
      );
    }
  });

  it("labels synthetic plans and the injected red-team plan honestly", () => {
    expect(TERRAFORM_REVIEW_EXAMPLES).toMatchObject([
      {
        sourceId: "terraform-safe-scale-up",
        session: {
          source: "authored-fixture",
          provenance: "authored-synthetic",
        },
      },
      {
        sourceId: "terraform-destroys-database",
        session: {
          source: "authored-fixture",
          provenance: "authored-synthetic",
        },
      },
      {
        sourceId: "terraform-protected-and-injected",
        session: {
          source: "authored-fixture",
          provenance: "authored-red-team",
        },
      },
      {
        sourceId: "terraform-large-plan-boundary",
        session: {
          source: "authored-fixture",
          provenance: "authored-synthetic",
        },
      },
      {
        sourceId: "scenario-p-injected-pr-context",
        session: {
          source: "authored-fixture",
          provenance: "authored-red-team",
        },
      },
    ]);
  });

  it("ships a schema-valid large plan beyond the initial presentation page", () => {
    const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES.find(
      (candidate) => candidate.sourceId === "terraform-large-plan-boundary",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const input = normalizePlan(fixture.plan, { planId: fixture.inputId });
    const proposal = deriveProposal(input);
    expect(input.changes).toHaveLength(LARGE_TERRAFORM_CHANGE_COUNT);
    expect(proposal.operations).toHaveLength(LARGE_TERRAFORM_CHANGE_COUNT);
    expect(JSON.stringify(proposal).length).toBeGreaterThan(12_000);
  });

  it("binds the red-team provenance to the single bundled untrusted body", () => {
    const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES.find(
      (candidate) => candidate.sourceId === "terraform-protected-and-injected",
    );

    expect(fixture).toMatchObject({
      provenance: "authored-red-team",
      context: [
        {
          kind: "pull request body",
          text: INJECTED_PULL_REQUEST_BODY,
        },
      ],
    });
    expect(INJECTED_PULL_REQUEST_BODY).toContain("Ignore previous safety rules");
  });
});
