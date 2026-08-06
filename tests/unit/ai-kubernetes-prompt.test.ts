import { describe, expect, it } from "vitest";

import {
  KUBERNETES_SYSTEM_INSTRUCTIONS,
  buildKubernetesAnalysisInput,
  kubernetesAnalysisPrompt,
  resolveAnalysisDomain,
  validateModelProposal,
} from "@changesafe/ai";
import { KubernetesSnapshotSchema, type KubernetesSnapshot } from "@changesafe/domain-kubernetes";
import { DomainError } from "@changesafe/core";
import { SCENARIOS, getScenario } from "@/scenarios";

function snapshotOf(scenarioId: string): KubernetesSnapshot {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`missing scenario ${scenarioId}`);
  return KubernetesSnapshotSchema.parse(scenario.input);
}

function proposalOf(scenarioId: string) {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`missing scenario ${scenarioId}`);
  return scenario.proposal;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error("expected a DomainError");
}

describe("kubernetes analysis prompt", () => {
  it("accepts a bundled proposal that replaces an existing resource", () => {
    const snapshot = snapshotOf("scenario-q-safe-scale-up");
    expect(() =>
      validateModelProposal(kubernetesAnalysisPrompt, snapshot, proposalOf("scenario-q-safe-scale-up")),
    ).not.toThrow();
  });

  it("accepts creating a resource and removing it again in rollback", () => {
    // The cross-check must not judge an `add` against the pre-change state:
    // the resource is *supposed* not to exist yet, and the rollback `remove`
    // that undoes it targets something only the forward operation created.
    // Rejecting either would refuse correct proposals.
    const snapshot = snapshotOf("scenario-z-orphaned-canary-service");
    const proposal = proposalOf("scenario-z-orphaned-canary-service");

    expect(proposal.operations[0]?.op).toBe("add");
    expect(proposal.rollbackOperations[0]?.op).toBe("remove");
    expect(() =>
      validateModelProposal(kubernetesAnalysisPrompt, snapshot, proposal),
    ).not.toThrow();
  });

  it("rejects replacing a resource the snapshot does not contain", () => {
    const snapshot = snapshotOf("scenario-q-safe-scale-up");
    const proposal = proposalOf("scenario-q-safe-scale-up");
    const invented = {
      ...proposal,
      operations: proposal.operations.map((operation) => ({
        ...operation,
        op: "replace" as const,
        path: "/resources/res-0000000000000000",
      })),
    };

    expect(codeOf(() => validateModelProposal(kubernetesAnalysisPrompt, snapshot, invented))).toBe(
      "AI_INVALID_OUTPUT",
    );
    // Asserted on the message too: a schema mismatch also reports
    // AI_INVALID_OUTPUT, so the code alone would let this pass for the wrong
    // reason if the cross-check ever stopped running.
    expect(() => validateModelProposal(kubernetesAnalysisPrompt, snapshot, invented)).toThrow(
      /replacing resources that do not exist/,
    );
  });

  it("rejects invented evidence ids", () => {
    const snapshot = snapshotOf("scenario-q-safe-scale-up");
    const proposal = proposalOf("scenario-q-safe-scale-up");
    const ungrounded = {
      ...proposal,
      diagnosis: { ...proposal.diagnosis, evidenceIds: ["ev-res-1111111111111111"] },
    };

    expect(codeOf(() => validateModelProposal(kubernetesAnalysisPrompt, snapshot, ungrounded))).toBe(
      "EVIDENCE_UNKNOWN",
    );
  });

  it("parses and renders every bundled kubernetes scenario", () => {
    // What `eval --domain kubernetes` does to each corpus entry before it
    // spends a cent: parse with the domain's own schema, then build the user
    // content. A scenario the analysis domain cannot read would otherwise
    // surface only during a paid run.
    const domain = resolveAnalysisDomain("kubernetes");
    const kubernetes = SCENARIOS.filter((scenario) => scenario.domainId === "kubernetes");

    expect(kubernetes.length).toBeGreaterThan(0);
    for (const scenario of kubernetes) {
      const parsed = domain.parseInput(scenario.input) as KubernetesSnapshot;
      const content = buildKubernetesAnalysisInput(parsed);
      expect(content).toContain("<untrusted_snapshot_data>");
      for (const resource of parsed.resources) {
        expect(content).toContain(resource.resourceId);
      }
    }
  });

  it("keeps the snapshot inside untrusted delimiters and out of the trusted channel", () => {
    const snapshot = snapshotOf("scenario-s-privileged-injection");
    const content = buildKubernetesAnalysisInput(snapshot);

    expect(content).toContain("<untrusted_snapshot_data>");
    expect(content).toContain("</untrusted_snapshot_data>");
    expect(content).toContain(snapshot.evidenceId);
    // The instructions are a fixed, operator-authored string: no snapshot
    // content may reach the channel the model is told to trust.
    expect(KUBERNETES_SYSTEM_INSTRUCTIONS).not.toContain(snapshot.snapshotId);
    expect(KUBERNETES_SYSTEM_INSTRUCTIONS).not.toContain(snapshot.evidenceId);
  });
});
