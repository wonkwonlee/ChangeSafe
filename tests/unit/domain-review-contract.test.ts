import { describe, expect, it } from "vitest";
import {
  REVIEW_CONTRACT_VERSION,
  ReviewContractErrorResultSchema,
  ReviewSessionEnvelopeSchema,
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
  domainId: "terraform",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "external-diff",
  capabilities: {
    sandboxSimulation: false,
    resourceGraph: false,
    structuredDiff: true,
    untrustedContext: true,
    durableDecision: true,
  },
  runtimeMode: "self-hosted",
  source: "uploaded-offline-artifact",
  analysisMode: "offline",
  provenance: "uploaded-offline-artifact",
} as const;

const kubernetesSession = {
  domainId: "kubernetes",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "external-diff",
  capabilities: {
    sandboxSimulation: false,
    resourceGraph: true,
    structuredDiff: true,
    untrustedContext: true,
    durableDecision: false,
  },
  runtimeMode: "public-replay",
  source: "authored-fixture",
  analysisMode: "replay",
  provenance: "authored-red-team",
} as const;

describe("ReviewSessionEnvelopeSchema", () => {
  it.each([
    ["Network", networkSession],
    ["Terraform", terraformSession],
    ["Kubernetes", kubernetesSession],
  ])("accepts the common %s review envelope without an adapter", (_name, session) => {
    expect(ReviewSessionEnvelopeSchema.safeParse(session).success).toBe(true);
  });

  it("rejects unknown keys at the envelope and capability boundaries", () => {
    expect(
      ReviewSessionEnvelopeSchema.safeParse({ ...networkSession, presentation: "console" })
        .success,
    ).toBe(false);
    expect(
      ReviewSessionEnvelopeSchema.safeParse({
        ...networkSession,
        capabilities: {
          ...networkSession.capabilities,
          autoApproval: true,
        },
      }).success,
    ).toBe(false);
  });

  it.each(["Network", "-network", "network_domain", "network--edge", "network-"])(
    "rejects invalid stable domain id %s",
    (domainId) => {
      expect(
        ReviewSessionEnvelopeSchema.safeParse({ ...networkSession, domainId }).success,
      ).toBe(false);
    },
  );

  it("rejects unknown runtime and analysis modes", () => {
    expect(
      ReviewSessionEnvelopeSchema.safeParse({
        ...networkSession,
        runtimeMode: "hosted-demo",
      }).success,
    ).toBe(false);
    expect(
      ReviewSessionEnvelopeSchema.safeParse({
        ...networkSession,
        analysisMode: "automatic",
      }).success,
    ).toBe(false);
  });

  it("rejects a mismatched review contract version", () => {
    expect(
      ReviewSessionEnvelopeSchema.safeParse({
        ...networkSession,
        contractVersion: "2.0.0",
      }).success,
    ).toBe(false);
  });

  it("rejects sandbox simulation for an external-diff domain", () => {
    expect(
      ReviewSessionEnvelopeSchema.safeParse({
        ...terraformSession,
        capabilities: {
          ...terraformSession.capabilities,
          sandboxSimulation: true,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects durable decision support in public replay mode", () => {
    expect(
      ReviewSessionEnvelopeSchema.safeParse({
        ...networkSession,
        capabilities: {
          ...networkSession.capabilities,
          durableDecision: true,
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["bundled-replay", "replay", "captured-replay"],
    ["authored-fixture", "replay", "authored-synthetic"],
    ["authored-fixture", "replay", "authored-red-team"],
    ["live-model", "live", "live-model"],
    ["uploaded-offline-artifact", "offline", "uploaded-offline-artifact"],
    ["read-only-collector", "offline", "read-only-collector"],
  ] as const)(
    "accepts source %s with its %s analysis and %s provenance",
    (source, analysisMode, provenance) => {
      expect(
        ReviewSessionEnvelopeSchema.safeParse({
          ...terraformSession,
          source,
          analysisMode,
          provenance,
        }).success,
      ).toBe(true);
    },
  );

  it("rejects an incoherent source, analysis mode, and provenance classification", () => {
    expect(
      ReviewSessionEnvelopeSchema.safeParse({
        ...networkSession,
        source: "live-model",
        analysisMode: "replay",
        provenance: "authored-synthetic",
      }).success,
    ).toBe(false);
  });
});

describe("ReviewContractErrorResultSchema", () => {
  it.each([
    {
      ok: false,
      error: {
        code: "UNKNOWN_DOMAIN",
        domainId: "future-domain",
      },
    },
    {
      ok: false,
      error: {
        code: "CONTRACT_VERSION_MISMATCH",
        domainId: "network",
        expectedContractVersion: REVIEW_CONTRACT_VERSION,
        receivedContractVersion: "2.0.0",
      },
    },
  ])("accepts a safe typed contract failure", (result) => {
    expect(ReviewContractErrorResultSchema.safeParse(result).success).toBe(true);
  });

  it("rejects a contract mismatch error when received and expected versions are equal", () => {
    expect(
      ReviewContractErrorResultSchema.safeParse({
        ok: false,
        error: {
          code: "CONTRACT_VERSION_MISMATCH",
          domainId: "network",
          expectedContractVersion: "1.0.0",
          receivedContractVersion: "1.0.0",
        },
      }).success,
    ).toBe(false);
  });
});
