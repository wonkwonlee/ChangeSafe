import { describe, expect, it } from "vitest";

import { deriveProposal } from "@changesafe/domain-terraform";

import {
  LARGE_TERRAFORM_CHANGE_COUNT,
  TERRAFORM_PUBLIC_REPLAY_FIXTURES,
} from "@/features/domains/terraform/fixtures";
import {
  TERRAFORM_REVIEW_EXAMPLES,
} from "@/features/domains/terraform/examples";
import {
  REVIEW_CONTRACT_VERSION,
  ReviewExampleDescriptorSchema,
} from "@/features/domains/review-contract";
import { TERRAFORM_SCENARIOS } from "@/scenarios/terraform";

/**
 * Non-scenario fixtures the picker keeps deliberately. Each proves a
 * structural property of the presentation layer that no narrative scenario in
 * `scenarios/terraform/*` is shaped to exercise.
 */
const STRUCTURAL_FIXTURE_IDS = ["terraform-large-plan-boundary"] as const;

describe("Terraform review examples", () => {
  it("publishes every registered Terraform scenario plus the structural fixtures, exactly once", () => {
    const ids = TERRAFORM_REVIEW_EXAMPLES.map((example) => example.sourceId);

    // The scenario corpus drives the picker: a scenario added to
    // scenarios/terraform.ts must surface publicly with no change here.
    expect(ids).toEqual([
      ...TERRAFORM_SCENARIOS.map((scenario) => scenario.scenarioId),
      ...STRUCTURAL_FIXTURE_IDS,
    ]);
    expect(ids).toHaveLength(
      TERRAFORM_SCENARIOS.length + STRUCTURAL_FIXTURE_IDS.length,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(TERRAFORM_PUBLIC_REPLAY_FIXTURES.map((fixture) => fixture.sourceId)).toEqual(ids);
  });

  it("carries each scenario's own label, description, and case-study link", () => {
    for (const scenario of TERRAFORM_SCENARIOS) {
      const example = TERRAFORM_REVIEW_EXAMPLES.find(
        (candidate) => candidate.sourceId === scenario.scenarioId,
      );
      expect(example, scenario.scenarioId).toBeDefined();
      expect(example).toMatchObject({
        label: scenario.label,
        description: scenario.shortDescription,
      });
    }

    expect(
      TERRAFORM_REVIEW_EXAMPLES.find(
        (example) => example.sourceId === "scenario-p-injected-pr-context",
      )?.caseStudy,
    ).toBe("Case 3: Same story, AI coding agent and Terraform");
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
          source: "authored-fixture",
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

  it("derives its proposal solely from the bundled fictional plan, evidence id for evidence id", () => {
    for (const fixture of TERRAFORM_PUBLIC_REPLAY_FIXTURES) {
      const proposal = deriveProposal(fixture.input);

      expect(fixture.input.planId).toBe(fixture.inputId);
      expect(proposal.proposalId).toBe("prop-terraform-plan");
      expect(proposal.operations).toHaveLength(fixture.input.changes.length);
      expect(proposal.operations.flatMap((operation) => operation.evidenceIds)).toEqual(
        fixture.input.changes.map((change) => change.evidenceId),
      );
    }
  });

  it("declares red-team provenance for exactly the adversarial scenarios", () => {
    for (const scenario of TERRAFORM_SCENARIOS) {
      const example = TERRAFORM_REVIEW_EXAMPLES.find(
        (candidate) => candidate.sourceId === scenario.scenarioId,
      );
      expect(example?.session.provenance, scenario.scenarioId).toBe(
        scenario.expectations.corpus.adversarial
          ? "authored-red-team"
          : "authored-synthetic",
      );
    }

    // Terraform is external-diff, so there is no captured model output to
    // replay; nothing here may claim a bundled capture.
    expect(
      TERRAFORM_REVIEW_EXAMPLES.every(
        (example) => example.session.source === "authored-fixture",
      ),
    ).toBe(true);
  });

  it("keeps the large-value fixture that no scenario's value sizes reproduce", () => {
    const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES.find(
      (candidate) => candidate.sourceId === "terraform-large-plan-boundary",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const proposal = deriveProposal(fixture.input);
    expect(fixture.input.changes).toHaveLength(LARGE_TERRAFORM_CHANGE_COUNT);
    expect(proposal.operations).toHaveLength(LARGE_TERRAFORM_CHANGE_COUNT);
    expect(JSON.stringify(proposal).length).toBeGreaterThan(12_000);

    // This fixture's reason to exist is per-change value size, not change
    // count: `scenario-t-blast-radius-drift` already pages past
    // MAX_VISIBLE_OFFLINE_ITEMS, but every one of its individual values is
    // small enough to render whole.
    const largestFixtureValue = Math.max(
      ...fixture.input.changes.map((change) => JSON.stringify(change).length),
    );
    const largestScenarioValue = Math.max(
      ...TERRAFORM_SCENARIOS.flatMap((scenario) =>
        scenario.input.changes.map((change) => JSON.stringify(change).length),
      ),
    );
    expect(largestFixtureValue).toBeGreaterThan(largestScenarioValue);
  });

  it("reuses the scenario corpus's own canonical normalization rather than a second one", () => {
    // A second `normalizePlan` call in the app layer would let the public
    // workbench and `changesafe gate` disagree about the very same plan.
    for (const scenario of TERRAFORM_SCENARIOS) {
      const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES.find(
        (candidate) => candidate.sourceId === scenario.scenarioId,
      );
      expect(fixture?.input, scenario.scenarioId).toBe(scenario.input);
    }

    const boundary = TERRAFORM_PUBLIC_REPLAY_FIXTURES.find(
      (candidate) => candidate.sourceId === "terraform-large-plan-boundary",
    );
    expect(boundary?.input.planId).toBe("terraform-large-plan-boundary");
  });
});
