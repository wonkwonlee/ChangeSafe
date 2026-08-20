import { describe, expect, it } from "vitest";

import { ChangeProposalSchema as CorePermissiveChangeProposalSchema } from "@changesafe/core";

import { KUBERNETES_PUBLIC_REPLAY_FIXTURES } from "@/features/domains/kubernetes/fixtures";
import {
  MAX_TRANSPORTED_EVIDENCE_IDS_PER_CLAIM,
  ReviewProposalProvenanceSchema,
  ReviewTransportChangeProposalSchema,
} from "@/features/domains/review-contract";

function evidenceIds(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `ev-item-${index.toString().padStart(4, "0")}`,
  );
}

function minimalProposal(diagnosisEvidenceCount: number) {
  return {
    proposalId: "prop-transport-limit-check",
    summary: "synthetic proposal exercising the transport schema's evidence-id ceiling",
    diagnosis: {
      likelyCause: "synthetic",
      confidence: 1,
      evidenceIds: evidenceIds(diagnosisEvidenceCount),
      assumptions: [],
    },
    operations: [
      {
        op: "replace" as const,
        path: "/synthetic/path",
        value: null,
        reason: "synthetic",
        evidenceIds: evidenceIds(1),
      },
    ],
    rollbackOperations: [],
    verificationSteps: [],
  };
}

describe("review-contract transport limits", () => {
  it("accepts a machine-derived diagnosis citing more than the model-authored default of 20 evidence ids", () => {
    // scenario-t-blast-radius-drift (20 changes) sat exactly at the old
    // default ceiling; a 21+-change plan silently 500'd at the analyze route
    // until the transport schema's evidence-id limit matched the domain
    // schemas it carries (TerraformChangeProposalSchema permits 2000).
    const proposal = minimalProposal(25);
    expect(() => ReviewTransportChangeProposalSchema.parse(proposal)).not.toThrow();
    // Prove the distinction is real: core's model-authored default still rejects it.
    expect(() => CorePermissiveChangeProposalSchema.parse(proposal)).toThrow();
  });

  it(`matches its declared ceiling of ${MAX_TRANSPORTED_EVIDENCE_IDS_PER_CLAIM} evidence ids per claim`, () => {
    const atLimit = minimalProposal(MAX_TRANSPORTED_EVIDENCE_IDS_PER_CLAIM);
    expect(() => ReviewTransportChangeProposalSchema.parse(atLimit)).not.toThrow();

    const overLimit = minimalProposal(MAX_TRANSPORTED_EVIDENCE_IDS_PER_CLAIM + 1);
    expect(() => ReviewTransportChangeProposalSchema.parse(overLimit)).toThrow();
  });

  it("threads each Kubernetes fixture's own model into captured-replay provenance instead of hardcoding null", () => {
    for (const fixture of KUBERNETES_PUBLIC_REPLAY_FIXTURES) {
      // The bug this guards: the analyze route once hardcoded `model: null`
      // for every Kubernetes source regardless of provenance, which fails
      // ReviewProposalProvenanceSchema the moment a fixture ever declares
      // captured-replay provenance (currently none do, but the type permits it).
      if (fixture.provenance === "captured-replay") {
        expect(fixture.model, fixture.sourceId).not.toBeNull();
      } else {
        expect(fixture.model, fixture.sourceId).toBeNull();
      }
      expect(() =>
        ReviewProposalProvenanceSchema.parse({
          classification: fixture.provenance,
          model: fixture.model,
          provider: null,
          fixtureId: fixture.sourceId,
          notes: null,
        }),
      ).not.toThrow();
    }
  });
});
