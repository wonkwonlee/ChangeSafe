import { describe, expect, it } from "vitest";
import {
  REVIEW_CONTRACT_VERSION,
  ReviewAnalysisResultSchema,
  ReviewChangeViewModelSchema,
  ReviewEvidenceViewModelSchema,
  ReviewExampleDescriptorSchema,
  ReviewImpactViewModelSchema,
  ReviewSummaryViewModelSchema,
  ReviewTransportErrorSchema,
} from "@/features/domains/review-contract";

const networkSession = {
  domainId: "network",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "simulated-state",
  capabilities: {
    sandboxSimulation: true,
    resourceGraph: true,
    structuredDiff: true,
    untrustedContext: true,
    durableDecision: false,
  },
  runtimeMode: "public-replay",
  source: "bundled-replay",
  analysisMode: "replay",
  provenance: "captured-replay",
} as const;

const terraformSession = {
  ...networkSession,
  domainId: "terraform",
  domainShape: "external-diff",
  capabilities: {
    ...networkSession.capabilities,
    sandboxSimulation: false,
  },
  runtimeMode: "self-hosted",
  source: "uploaded-offline-artifact",
  analysisMode: "offline",
  provenance: "uploaded-offline-artifact",
} as const;

const proposal = {
  proposalId: "proposal-one",
  summary: "Replace one declarative value",
  diagnosis: {
    likelyCause: "A stale value was detected.",
    confidence: 0.8,
    evidenceIds: ["ev-alert-001"],
    assumptions: [],
  },
  operations: [
    {
      op: "replace",
      path: "/devices/edge-router",
      value: { enabled: true },
      reason: "Restore the intended state.",
      evidenceIds: ["ev-alert-001"],
    },
  ],
  rollbackOperations: [
    {
      op: "replace",
      path: "/devices/edge-router",
      value: { enabled: false },
      reason: "Restore the prior state.",
      evidenceIds: ["ev-alert-001"],
    },
  ],
  verificationSteps: [
    {
      kind: "postcheck",
      description: "Verify the declared state.",
      evidenceIds: ["ev-alert-001"],
    },
  ],
} as const;

const finding = {
  policyId: "PATCH_SCHEMA",
  status: "PASS",
  title: "Patch is valid",
  explanation: "The declarative operation has a supported shape.",
  affectedResources: ["device:edge-router"],
  remediation: null,
} as const;

const validAnalysis = {
  ok: true,
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainId: "network",
  session: networkSession,
  sourceId: "scenario-one",
  inputId: "incident-one",
  input: { alert: "Link instability" },
  proposal,
  findings: [finding],
  riskLevel: "LOW",
  provenance: {
    classification: "captured-replay",
    model: "gpt-5.6",
    provider: null,
    fixtureId: "fixture-one",
    notes: "Captured model output replayed without a live request.",
  },
  effectCapability: {
    kind: "sandbox-simulation",
  },
} as const;

describe("v1 review registry and analysis contracts", () => {
  it("parses a domain-tagged example and complete analysis result", () => {
    expect(
      ReviewExampleDescriptorSchema.parse({
        domainId: "network",
        contractVersion: REVIEW_CONTRACT_VERSION,
        sourceId: "scenario-one",
        label: "Network failover",
        description: "A fictional replay for deterministic review.",
        session: networkSession,
      }),
    ).toMatchObject({ domainId: "network", sourceId: "scenario-one" });

    expect(ReviewAnalysisResultSchema.parse(validAnalysis)).toMatchObject({
      ok: true,
      domainId: "network",
      riskLevel: "LOW",
      effectCapability: { kind: "sandbox-simulation" },
    });
  });

  it("fails closed when an outer domain tag is unknown to the selected session", () => {
    expect(
      ReviewExampleDescriptorSchema.safeParse({
        domainId: "future-domain",
        contractVersion: REVIEW_CONTRACT_VERSION,
        sourceId: "scenario-one",
        label: "Future domain",
        description: "Must not masquerade as a registered network example.",
        session: networkSession,
      }).success,
    ).toBe(false);

    expect(
      ReviewTransportErrorSchema.parse({
        ok: false,
        contractVersion: REVIEW_CONTRACT_VERSION,
        error: {
          code: "UNKNOWN_DOMAIN",
          message: "No registered review domain matches future-domain.",
          domainId: "future-domain",
          replayAvailable: false,
          expectedContractVersion: null,
          receivedContractVersion: null,
        },
      }),
    ).toMatchObject({ error: { code: "UNKNOWN_DOMAIN" } });
  });

  it("rejects contract mismatches and extra keys at strict boundaries", () => {
    expect(
      ReviewAnalysisResultSchema.safeParse({
        ...validAnalysis,
        contractVersion: "2.0.0",
      }).success,
    ).toBe(false);
    expect(
      ReviewAnalysisResultSchema.safeParse({
        ...validAnalysis,
        provenance: {
          ...validAnalysis.provenance,
          trusted: true,
        },
      }).success,
    ).toBe(false);
    expect(
      ReviewTransportErrorSchema.safeParse({
        ok: false,
        contractVersion: REVIEW_CONTRACT_VERSION,
        error: {
          code: "CONTRACT_VERSION_MISMATCH",
          message: "The review contract version is unsupported.",
          domainId: "network",
          replayAvailable: true,
          expectedContractVersion: REVIEW_CONTRACT_VERSION,
          receivedContractVersion: REVIEW_CONTRACT_VERSION,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects effect capabilities that contradict the domain shape", () => {
    expect(
      ReviewAnalysisResultSchema.safeParse({
        ...validAnalysis,
        domainId: "terraform",
        session: terraformSession,
        provenance: {
          classification: "uploaded-offline-artifact",
          model: null,
          provider: null,
          fixtureId: null,
          notes: null,
        },
      }).success,
    ).toBe(false);
    expect(
      ReviewAnalysisResultSchema.safeParse({
        ...validAnalysis,
        effectCapability: { kind: "external-diff" },
      }).success,
    ).toBe(false);
    expect(
      ReviewAnalysisResultSchema.safeParse({
        ...validAnalysis,
        domainId: "terraform",
        session: terraformSession,
        provenance: {
          classification: "uploaded-offline-artifact",
          model: null,
          provider: null,
          fixtureId: null,
          notes: null,
        },
        effectCapability: { kind: "unavailable", reason: "No effect data." },
      }).success,
    ).toBe(false);
    expect(
      ReviewAnalysisResultSchema.safeParse({
        ...validAnalysis,
        effectCapability: { kind: "sandbox-simulation", executable: true },
      }).success,
    ).toBe(false);
  });
});

describe("shared review presentation contracts", () => {
  it("parses summary, evidence, change, and effect view models", () => {
    expect(
      ReviewSummaryViewModelSchema.parse({
        title: "Network failover",
        description: "Review the evidence and deterministic findings.",
        inputId: "incident-one",
        sourceId: "scenario-one",
      }),
    ).toMatchObject({ inputId: "incident-one" });

    expect(
      ReviewEvidenceViewModelSchema.parse({
        title: "Evidence",
        items: [
          {
            evidenceId: "ev-alert-001",
            label: "Alert",
            detail: "Untrusted alert text.",
            untrusted: true,
          },
        ],
      }),
    ).toMatchObject({ items: [{ untrusted: true }] });

    expect(
      ReviewChangeViewModelSchema.parse({
        title: "Proposed changes",
        summary: "One declarative replacement.",
        items: [
          {
            op: "replace",
            path: "/devices/edge-router",
            summary: "Enable the edge router.",
          },
        ],
      }),
    ).toMatchObject({ items: [{ op: "replace" }] });

    expect(
      ReviewImpactViewModelSchema.parse({
        kind: "sandbox-simulation",
        title: "Sandbox impact",
        summary: "One resource changes on a deep clone.",
        changedResourceIds: ["device:edge-router"],
        safetyProperties: [
          {
            propertyId: "management-reachable",
            satisfied: true,
            detail: "Management remains reachable.",
          },
        ],
      }),
    ).toMatchObject({ kind: "sandbox-simulation" });
  });

  it("rejects unknown presentation keys and invalid impact variants", () => {
    expect(
      ReviewSummaryViewModelSchema.safeParse({
        title: "Network failover",
        description: "Review the proposal.",
        inputId: "incident-one",
        sourceId: "scenario-one",
        approved: true,
      }).success,
    ).toBe(false);
    expect(
      ReviewImpactViewModelSchema.safeParse({
        kind: "unavailable",
        title: "Impact unavailable",
        reason: "No sandbox exists.",
        changedResourceIds: [],
      }).success,
    ).toBe(false);
  });
});
