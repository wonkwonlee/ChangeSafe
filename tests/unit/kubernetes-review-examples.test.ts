import { canonicalize, evaluatePolicies } from "@changesafe/core";
import {
  deriveManifestProposal,
  kubernetesDomain,
} from "@changesafe/domain-kubernetes";
import { describe, expect, it } from "vitest";

import {
  LARGE_KUBERNETES_PROPOSAL_OPERATION_COUNT,
  LARGE_KUBERNETES_WORKLOAD_COUNT,
  KUBERNETES_PUBLIC_REPLAY_FIXTURES,
  KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
  KUBERNETES_PUBLIC_REPLAY_SOURCES,
  KUBERNETES_UNSUPPORTED_PUBLIC_REPLAY_SOURCE,
  resolveKubernetesPublicReplayFixture,
} from "@/features/domains/kubernetes/fixtures";
import { KUBERNETES_REVIEW_EXAMPLES } from "@/features/domains/kubernetes/examples";
import {
  REVIEW_CONTRACT_VERSION,
  ReviewExampleDescriptorSchema,
} from "@/features/domains/review-contract";
import { KUBERNETES_SCENARIOS } from "@/scenarios/kubernetes";

/**
 * Non-scenario sources the picker keeps deliberately. Each proves a structural
 * property no narrative scenario in `scenarios/kubernetes/*` is shaped to
 * exercise: presentation bounds, and pre-review rejection of a manifest kind
 * outside the offline contract.
 */
const STRUCTURAL_FIXTURE_IDS = ["kubernetes-large-manifest-boundary"] as const;

describe("Kubernetes review examples", () => {
  it("publishes every registered Kubernetes scenario plus the structural fixtures, exactly once", () => {
    const ids = KUBERNETES_REVIEW_EXAMPLES.map((example) => example.sourceId);

    // The scenario corpus drives the picker: a scenario added to
    // scenarios/kubernetes.ts must surface publicly with no change here.
    expect(ids).toEqual([
      ...KUBERNETES_SCENARIOS.map((scenario) => scenario.scenarioId),
      ...STRUCTURAL_FIXTURE_IDS,
    ]);
    expect(ids).toHaveLength(
      KUBERNETES_SCENARIOS.length + STRUCTURAL_FIXTURE_IDS.length,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(KUBERNETES_PUBLIC_REPLAY_FIXTURES.map((fixture) => fixture.sourceId)).toEqual(ids);
    // Plus the unsupported source, which is a known id but never an example.
    expect(KUBERNETES_PUBLIC_REPLAY_SOURCES).toHaveLength(ids.length + 1);
  });

  it("carries each scenario's own label and description", () => {
    for (const scenario of KUBERNETES_SCENARIOS) {
      const example = KUBERNETES_REVIEW_EXAMPLES.find(
        (candidate) => candidate.sourceId === scenario.scenarioId,
      );
      expect(example, scenario.scenarioId).toBeDefined();
      expect(example).toMatchObject({
        label: scenario.label,
        description: scenario.shortDescription,
        // No docs/CASE_STUDIES.md case is a Kubernetes scenario yet.
        caseStudy: null,
      });
    }
  });

  it("uses valid simulated-state public replay descriptors without durable authority", () => {
    for (const descriptor of KUBERNETES_REVIEW_EXAMPLES) {
      expect(ReviewExampleDescriptorSchema.parse(descriptor)).toEqual(descriptor);
      expect(descriptor).toMatchObject({
        domainId: "kubernetes",
        contractVersion: REVIEW_CONTRACT_VERSION,
        session: {
          domainShape: "simulated-state",
          runtimeMode: "public-replay",
          analysisMode: "replay",
          capabilities: {
            sandboxSimulation: true,
            resourceGraph: true,
            structuredDiff: true,
            untrustedContext: true,
            durableDecision: false,
          },
        },
      });
    }
  });

  it("evaluates each scenario against its own snapshot and reproduces its declared contract", () => {
    for (const scenario of KUBERNETES_SCENARIOS) {
      const fixture = KUBERNETES_PUBLIC_REPLAY_FIXTURES.find(
        (candidate) => candidate.sourceId === scenario.scenarioId,
      );
      expect(fixture, scenario.scenarioId).toBeDefined();
      if (!fixture) continue;

      // Each Kubernetes scenario carries its own snapshot; sharing one across
      // the picker would silently evaluate a proposal against the wrong state.
      expect(fixture.snapshot, scenario.scenarioId).toBe(scenario.input);
      expect(fixture.inputId).toBe(scenario.input.snapshotId);

      const evaluation = evaluatePolicies(
        kubernetesDomain,
        fixture.snapshot,
        fixture.proposal,
      );
      // The corpus's expectations.json is the authority for the verdict; the
      // public picker must not be able to show a different one.
      expect(evaluation.riskLevel, scenario.scenarioId).toBe(
        scenario.expectations.riskLevel,
      );
      for (const finding of evaluation.findings) {
        expect(
          scenario.expectations.policies[finding.policyId],
          `${scenario.scenarioId}/${finding.policyId}`,
        ).toBe(finding.status);
      }
      expect(canonicalize(resolveKubernetesPublicReplayFixture(fixture.sourceId).proposal)).toBe(
        canonicalize(fixture.proposal),
      );
    }
  });

  it("restates the corpus's own provenance rather than inferring one", () => {
    for (const scenario of KUBERNETES_SCENARIOS) {
      const example = KUBERNETES_REVIEW_EXAMPLES.find(
        (candidate) => candidate.sourceId === scenario.scenarioId,
      );
      const expected =
        scenario.fixture.provenance === "captured"
          ? "captured-replay"
          : scenario.fixture.provenance === "authored_red_team"
            ? "authored-red-team"
            : "authored-synthetic";
      expect(example?.session.provenance, scenario.scenarioId).toBe(expected);
      expect(example?.session.source, scenario.scenarioId).toBe(
        expected === "captured-replay" ? "bundled-replay" : "authored-fixture",
      );
      // An adversarial scenario may still ship an honestly authored proposal;
      // provenance is never derived from the scenario's corpus flag.
      if (scenario.fixture.provenance !== "captured") {
        expect(example?.session.provenance).not.toBe("captured-replay");
      }
    }
  });

  it("rejects the unsupported adversarial source before a result exists", () => {
    expect(KUBERNETES_UNSUPPORTED_PUBLIC_REPLAY_SOURCE).toMatchObject({
      sourceId: "kubernetes-unsupported-secret",
      provenance: "authored-red-team",
      rejection: "unsupported-manifest-kind",
    });
    expect(KUBERNETES_REVIEW_EXAMPLES.map((example) => example.sourceId)).not.toContain(
      KUBERNETES_UNSUPPORTED_PUBLIC_REPLAY_SOURCE.sourceId,
    );
    expect(() =>
      resolveKubernetesPublicReplayFixture(
        KUBERNETES_UNSUPPORTED_PUBLIC_REPLAY_SOURCE.sourceId,
      ),
    ).toThrow(/unsupported/i);
  });

  it("keeps the presentation-boundary fixture no scenario is large enough to replace", () => {
    const largeFixture = KUBERNETES_PUBLIC_REPLAY_FIXTURES.find(
      (fixture) => fixture.sourceId === "kubernetes-large-manifest-boundary",
    );
    expect(largeFixture).toBeDefined();
    if (!largeFixture) return;

    expect(largeFixture.snapshot).toBe(KUBERNETES_PUBLIC_REPLAY_SNAPSHOT);
    const workerResources = KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.resources.filter(
      (resource) =>
        resource.identity.kind === "Deployment" &&
        "podLabels" in resource.spec &&
        resource.spec.podLabels?.group === "boundary-worker",
    );
    expect(workerResources).toHaveLength(LARGE_KUBERNETES_WORKLOAD_COUNT);
    expect(largeFixture.proposal.operations).toHaveLength(
      LARGE_KUBERNETES_PROPOSAL_OPERATION_COUNT,
    );
    expect(JSON.stringify(largeFixture.proposal).length).toBeGreaterThan(12_000);

    // The corpus's Kubernetes scenarios are all single-operation, small-
    // inventory narratives, so none of them exercises the paging bounds this
    // fixture exists to prove.
    for (const scenario of KUBERNETES_SCENARIOS) {
      expect(scenario.proposal.operations.length).toBeLessThan(
        LARGE_KUBERNETES_PROPOSAL_OPERATION_COUNT,
      );
      expect(scenario.input.resources.length).toBeLessThan(
        LARGE_KUBERNETES_WORKLOAD_COUNT,
      );
    }

    // The hand-authored fixture still derives through the production path.
    const freshlyDerived = deriveManifestProposal(KUBERNETES_PUBLIC_REPLAY_SNAPSHOT, {
      documents: [...(largeFixture.manifestDocuments ?? [])],
    });
    expect(canonicalize(freshlyDerived.proposal)).toBe(
      canonicalize(largeFixture.proposal),
    );
  });
});
