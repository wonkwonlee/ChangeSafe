import { describe, expect, it } from "vitest";

import {
  ReviewAnalyzeErrorV1Schema,
  ReviewAnalyzeRequestV1Schema,
  ReviewAnalyzeSuccessV1Schema,
} from "@/lib/domain/api";

const apiVersion = "v1";
const contractVersion = "1.0.0";

const request = {
  apiVersion,
  domainId: "network",
  contractVersion,
  sourceId: "scenario-one",
  analysisMode: "replay",
} as const;

const networkSession = {
  domainId: "network",
  contractVersion,
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

const analysisResult = {
  ok: true,
  contractVersion,
  domainId: "network",
  session: networkSession,
  sourceId: "scenario-one",
  inputId: "incident-one",
  input: {
    incidentId: "incident-one",
    alert: "Link instability",
  },
  proposal: {
    proposalId: "proposal-one",
    summary: "Replace one declarative value.",
    diagnosis: {
      likelyCause: "A stale value was detected.",
      confidence: 0.8,
      evidenceIds: ["ev-alert-001"],
      assumptions: [],
    },
    operations: [
      {
        op: "replace",
        path: "/resources/resource-one",
        value: { enabled: true },
        reason: "Restore the intended state.",
        evidenceIds: ["ev-alert-001"],
      },
    ],
    rollbackOperations: [
      {
        op: "replace",
        path: "/resources/resource-one",
        value: { enabled: false },
        reason: "Restore the prior state.",
        evidenceIds: ["ev-alert-001"],
      },
    ],
    verificationSteps: [],
  },
  findings: [
    {
      policyId: "PATCH_SCHEMA",
      status: "PASS",
      title: "Patch is valid",
      explanation: "The declarative operation has a supported shape.",
      affectedResources: ["resource:resource-one"],
      remediation: null,
    },
  ],
  riskLevel: "LOW",
  provenance: {
    classification: "captured-replay",
    model: "gpt-5.6",
    provider: null,
    fixtureId: "fixture-one",
    notes: "Captured output replayed without a live request.",
  },
  effectCapability: {
    kind: "sandbox-simulation",
  },
} as const;

describe("v1 review analyze API contracts", () => {
  it("accepts a strict Network replay request and validated success result", () => {
    expect(ReviewAnalyzeRequestV1Schema.parse(request)).toEqual(request);
    expect(
      ReviewAnalyzeSuccessV1Schema.parse({
        apiVersion,
        result: analysisResult,
      }),
    ).toMatchObject({
      apiVersion: "v1",
      result: {
        ok: true,
        domainId: "network",
        riskLevel: "LOW",
      },
    });
  });

  it.each([
    ["unknown domain", { ...request, domainId: "future-domain" }],
    ["API version mismatch", { ...request, apiVersion: "v2" }],
    ["contract version mismatch", { ...request, contractVersion: "2.0.0" }],
    ["unknown key", { ...request, appVersion: "0.2.0" }],
    [
      "client classification claim",
      { ...request, provenance: "captured-replay" },
    ],
  ])("rejects a request with %s", (_label, candidate) => {
    expect(
      ReviewAnalyzeRequestV1Schema.safeParse(candidate).success,
    ).toBe(false);
  });

  it("rejects unknown keys on the success envelope and nested result", () => {
    expect(
      ReviewAnalyzeSuccessV1Schema.safeParse({
        apiVersion,
        result: analysisResult,
        internal: true,
      }).success,
    ).toBe(false);
    expect(
      ReviewAnalyzeSuccessV1Schema.safeParse({
        apiVersion,
        result: {
          ...analysisResult,
          trustedClassification: true,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts the validated transport error envelope", () => {
    expect(
      ReviewAnalyzeErrorV1Schema.parse({
        apiVersion,
        result: {
          ok: false,
          contractVersion,
          error: {
            code: "SOURCE_UNKNOWN",
            message: "No registered source matches the request.",
            domainId: "network",
            replayAvailable: false,
            expectedContractVersion: null,
            receivedContractVersion: null,
          },
        },
      }),
    ).toMatchObject({
      apiVersion: "v1",
      result: {
        ok: false,
        error: { code: "SOURCE_UNKNOWN" },
      },
    });
  });

  it.each([
    [
      "wrong API version",
      {
        apiVersion: "v2",
        result: {
          ok: false,
          contractVersion,
          error: {
            code: "SOURCE_UNKNOWN",
            message: "No registered source matches the request.",
            domainId: "network",
            replayAvailable: false,
            expectedContractVersion: null,
            receivedContractVersion: null,
          },
        },
      },
    ],
    [
      "missing replay source",
      {
        apiVersion,
        result: {
          ok: false,
          contractVersion,
          error: {
            code: "ANALYSIS_FAILED",
            message: "Live analysis failed.",
            domainId: "network",
            replayAvailable: true,
            expectedContractVersion: null,
            receivedContractVersion: null,
          },
        },
      },
    ],
    [
      "unknown nested key",
      {
        apiVersion,
        result: {
          ok: false,
          contractVersion,
          error: {
            code: "INTERNAL",
            message: "The request could not be completed.",
            domainId: null,
            replayAvailable: false,
            expectedContractVersion: null,
            receivedContractVersion: null,
            stack: "must not cross the wire",
          },
        },
      },
    ],
  ])("rejects a malformed error envelope with %s", (_label, candidate) => {
    expect(
      ReviewAnalyzeErrorV1Schema.safeParse(candidate).success,
    ).toBe(false);
  });
});
