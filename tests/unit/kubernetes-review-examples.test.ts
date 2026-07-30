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

describe("Kubernetes review examples", () => {
  it("publishes each supported fictional replay fixture exactly once", () => {
    const ids = KUBERNETES_REVIEW_EXAMPLES.map((example) => example.sourceId);

    expect(ids).toEqual([
      "kubernetes-safe-scale",
      "kubernetes-selector-red-team",
      "kubernetes-large-manifest-boundary",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(KUBERNETES_PUBLIC_REPLAY_FIXTURES.map((fixture) => fixture.sourceId)).toEqual(ids);
    expect(KUBERNETES_PUBLIC_REPLAY_SOURCES).toHaveLength(4);
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
          source: "authored-fixture",
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

  it("derives deterministic safe and blocked policy outcomes from the sole offline fixture source", () => {
    const outcomes = KUBERNETES_PUBLIC_REPLAY_FIXTURES.map((fixture) => ({
      sourceId: fixture.sourceId,
      evaluation: evaluatePolicies(
        kubernetesDomain,
        KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
        fixture.proposal,
      ),
      canonicalProposal: canonicalize(fixture.proposal),
    }));

    expect(outcomes).toMatchObject([
      {
        sourceId: "kubernetes-safe-scale",
        evaluation: { riskLevel: "LOW" },
      },
      {
        sourceId: "kubernetes-selector-red-team",
        evaluation: { riskLevel: "CRITICAL" },
      },
      {
        sourceId: "kubernetes-large-manifest-boundary",
      },
    ]);
    expect(outcomes[0]?.evaluation.findings.some((finding) => finding.status === "BLOCK")).toBe(false);
    expect(outcomes[1]?.evaluation.findings).toContainEqual(
      expect.objectContaining({ policyId: "K8S_SERVICE_SELECTOR", status: "BLOCK" }),
    );
    for (const fixture of KUBERNETES_PUBLIC_REPLAY_FIXTURES) {
      const freshlyDerived = deriveManifestProposal(
        KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
        { documents: [...fixture.manifestDocuments] },
      );
      expect(canonicalize(freshlyDerived.proposal)).toBe(canonicalize(fixture.proposal));
      expect(canonicalize(resolveKubernetesPublicReplayFixture(fixture.sourceId).proposal)).toBe(
        outcomes.find((outcome) => outcome.sourceId === fixture.sourceId)?.canonicalProposal,
      );
    }
  });

  it("keeps authored provenance honest and rejects the unsupported adversarial source before a result exists", () => {
    expect(KUBERNETES_REVIEW_EXAMPLES).toMatchObject([
      { sourceId: "kubernetes-safe-scale", session: { provenance: "authored-synthetic" } },
      { sourceId: "kubernetes-selector-red-team", session: { provenance: "authored-red-team" } },
      {
        sourceId: "kubernetes-large-manifest-boundary",
        session: { provenance: "authored-synthetic" },
      },
    ]);
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

  it("ships schema-valid large snapshot associations and a long manifest proposal", () => {
    const largeFixture = KUBERNETES_PUBLIC_REPLAY_FIXTURES.find(
      (fixture) => fixture.sourceId === "kubernetes-large-manifest-boundary",
    );
    expect(largeFixture).toBeDefined();
    if (!largeFixture) return;

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
  });
});
