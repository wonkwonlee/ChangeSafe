import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ChangeProposalSchema,
  type DomainAdapter,
} from "@changesafe/core";
import {
  REVIEW_CONTRACT_VERSION,
} from "@/features/domains/review-contract";
import {
  DOMAIN_REGISTRY,
  defineDomainRegistry,
} from "@/features/domains/registry";
import { defineDomainPresentation } from "@/features/domains/presentation";
import {
  composeSessionCapabilities,
  defineExternalDiffRuntime,
  defineSimulatedRuntime,
  type DomainStaticCapabilities,
} from "@/features/domains/runtime";

const validProposal = ChangeProposalSchema.parse({
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
});

const presentationCapabilities: DomainStaticCapabilities = {
  sandboxSimulation: true,
  resourceGraph: true,
  structuredDiff: true,
  untrustedContext: true,
};

describe("closed domain registry", () => {
  it.each([
    ["network", "simulated-state", true],
    ["terraform", "external-diff", false],
    ["kubernetes", "simulated-state", true],
  ] as const)(
    "resolves the v1 %s runtime and presentation",
    (domainId, domainShape, hasSimulation) => {
      const resolution = DOMAIN_REGISTRY.resolve(
        domainId,
        REVIEW_CONTRACT_VERSION,
      );

      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;
      expect(resolution.entry.runtime.domainId).toBe(domainId);
      expect(resolution.entry.presentation.domainId).toBe(domainId);
      expect(resolution.entry.runtime.domainShape).toBe(domainShape);
      expect(resolution.entry.presentation.domainShape).toBe(domainShape);
      expect("simulate" in resolution.entry.runtime).toBe(hasSimulation);
    },
  );

  it("fails closed for unknown domains and incompatible contract versions", () => {
    expect(
      DOMAIN_REGISTRY.resolve("future-domain", REVIEW_CONTRACT_VERSION),
    ).toEqual({
      ok: false,
      error: {
        code: "UNKNOWN_DOMAIN",
        domainId: "future-domain",
      },
    });

    expect(DOMAIN_REGISTRY.resolve("network", "2.0.0")).toEqual({
      ok: false,
      error: {
        code: "CONTRACT_VERSION_MISMATCH",
        domainId: "network",
        expectedContractVersion: REVIEW_CONTRACT_VERSION,
        receivedContractVersion: "2.0.0",
      },
    });
  });

  it("keeps Terraform external-diff runtime free of simulation behavior", () => {
    const resolution = DOMAIN_REGISTRY.resolve(
      "terraform",
      REVIEW_CONTRACT_VERSION,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.entry.runtime.domainShape).toBe("external-diff");
    expect("simulate" in resolution.entry.runtime).toBe(false);
  });

  it.each([
    ["network", "public-replay", false],
    ["network", "self-hosted", false],
    ["terraform", "public-replay", false],
    ["terraform", "self-hosted", true],
    ["kubernetes", "public-replay", false],
    ["kubernetes", "self-hosted", false],
  ] as const)(
    "composes %s durable decision support for %s sessions",
    (domainId, runtimeMode, durableDecision) => {
      const resolution = DOMAIN_REGISTRY.resolve(
        domainId,
        REVIEW_CONTRACT_VERSION,
      );
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      expect(
        composeSessionCapabilities(resolution.entry.runtime, runtimeMode),
      ).toMatchObject({
        sandboxSimulation: domainId !== "terraform",
        durableDecision,
      });
    },
  );

  it("validates raw inputs before any adapter or policy access", () => {
    const InputSchema = z.strictObject({ inputId: z.literal("valid-input") });
    type Input = z.infer<typeof InputSchema>;
    let adapterAccessed = false;
    const adapter: DomainAdapter<Input, Input> = {
      domainId: "test-domain",
      policyVersion: "test-v1",
      stateOf(input) {
        adapterAccessed = true;
        return input;
      },
      applyOperations(state) {
        adapterAccessed = true;
        return { nextState: state, diff: [] };
      },
      blastRadiusUnit() {
        adapterAccessed = true;
        return null;
      },
      untrustedTexts() {
        adapterAccessed = true;
        return [];
      },
      knownEvidenceIds() {
        adapterAccessed = true;
        return new Set();
      },
      policies: [
        {
          id: "TEST_POLICY",
          evaluate() {
            adapterAccessed = true;
            return {
              policyId: "TEST_POLICY",
              status: "PASS",
              title: "Test policy",
              explanation: "The validated test input is accepted.",
              affectedResources: [],
              remediation: null,
            };
          },
        },
      ],
    };
    const runtime = defineSimulatedRuntime({
      domainId: "test-domain",
      contractVersion: REVIEW_CONTRACT_VERSION,
      capabilities: presentationCapabilities,
      selfHostedDurableDecision: false,
      inputSchema: InputSchema,
      proposalSchema: ChangeProposalSchema,
      adapter,
      simulate: () => ({
        status: "completed",
        changedResourceIds: [],
        diff: [],
        safetyProperties: [],
        summary: "No real infrastructure was contacted.",
      }),
    });

    expect(() =>
      runtime.evaluate({ inputId: "invalid-input" }, validProposal),
    ).toThrow();
    expect(adapterAccessed).toBe(false);
  });

  it("rejects sandbox declarations that contradict runtime shape and behavior", () => {
    const InputSchema = z.strictObject({ inputId: z.literal("valid-input") });
    type Input = z.infer<typeof InputSchema>;
    const adapter: DomainAdapter<Input, Input> = {
      domainId: "test-domain",
      policyVersion: "test-v1",
      stateOf: (input) => input,
      applyOperations: (state) => ({ nextState: state, diff: [] }),
      blastRadiusUnit: () => null,
      untrustedTexts: () => [],
      knownEvidenceIds: () => new Set(),
      policies: [],
    };
    const baseConfig = {
      domainId: "test-domain",
      contractVersion: REVIEW_CONTRACT_VERSION,
      selfHostedDurableDecision: false,
      inputSchema: InputSchema,
      proposalSchema: ChangeProposalSchema,
      adapter,
    };

    expect(() =>
      defineSimulatedRuntime({
        ...baseConfig,
        capabilities: {
          ...presentationCapabilities,
          sandboxSimulation: false,
        },
        simulate: () => ({
          status: "completed",
          changedResourceIds: [],
          diff: [],
          safetyProperties: [],
          summary: "No real infrastructure was contacted.",
        }),
      }),
    ).toThrow(/sandbox/i);

    expect(() =>
      defineExternalDiffRuntime({
        ...baseConfig,
        capabilities: presentationCapabilities,
      }),
    ).toThrow(/sandbox/i);

    expect(() =>
      defineDomainPresentation({
        domainId: "network",
        contractVersion: REVIEW_CONTRACT_VERSION,
        domainShape: "simulated-state",
        capabilities: {
          ...presentationCapabilities,
          sandboxSimulation: false,
        },
        selfHostedDurableDecision: false,
        label: "Contradictory Network",
        description: "A simulated-state presentation must expose simulation.",
      }),
    ).toThrow(/sandbox/i);

    const terraform = DOMAIN_REGISTRY.resolve(
      "terraform",
      REVIEW_CONTRACT_VERSION,
    );
    const network = DOMAIN_REGISTRY.resolve(
      "network",
      REVIEW_CONTRACT_VERSION,
    );
    expect(terraform.ok).toBe(true);
    expect(network.ok).toBe(true);
    if (
      !terraform.ok ||
      !network.ok ||
      network.entry.runtime.domainShape !== "simulated-state"
    ) {
      return;
    }
    const contradictoryRuntime = {
      ...terraform.entry.runtime,
      simulate: network.entry.runtime.simulate,
    };
    expect(() =>
      defineDomainRegistry([
        {
          runtime: contradictoryRuntime,
          presentation: terraform.entry.presentation,
        },
      ]),
    ).toThrow(/sandbox|simulate/i);
  });

  it("copies and freezes capability data so registry definitions cannot drift", () => {
    const mutableCapabilities = {
      ...presentationCapabilities,
    };
    const presentation = defineDomainPresentation({
      domainId: "network",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: mutableCapabilities,
      selfHostedDurableDecision: false,
      label: "Network",
      description: "Declarative network review.",
    });
    mutableCapabilities.structuredDiff = false;

    expect(presentation.capabilities.structuredDiff).toBe(true);
    expect(
      Reflect.set(presentation.capabilities, "structuredDiff", false),
    ).toBe(false);

    const network = DOMAIN_REGISTRY.resolve(
      "network",
      REVIEW_CONTRACT_VERSION,
    );
    expect(network.ok).toBe(true);
    if (!network.ok) return;
    expect(
      Reflect.set(network.entry.runtime.capabilities, "resourceGraph", false),
    ).toBe(false);
    const composed = composeSessionCapabilities(
      network.entry.runtime,
      "public-replay",
    );
    expect(Reflect.set(composed, "durableDecision", true)).toBe(false);
    expect(composed).toMatchObject({
      resourceGraph: true,
      durableDecision: false,
    });
  });

  it("rejects runtime and presentation definitions that disagree", () => {
    const network = DOMAIN_REGISTRY.resolve(
      "network",
      REVIEW_CONTRACT_VERSION,
    );
    expect(network.ok).toBe(true);
    if (!network.ok) return;

    const wrongDomainPresentation = defineDomainPresentation({
      domainId: "terraform",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: presentationCapabilities,
      selfHostedDurableDecision: false,
      label: "Wrong domain",
      description: "This presentation cannot be paired with Network.",
    });
    expect(() =>
      defineDomainRegistry([
        {
          runtime: network.entry.runtime,
          presentation: wrongDomainPresentation,
        },
      ]),
    ).toThrow(/domain/i);

    const wrongCapabilitiesPresentation = defineDomainPresentation({
      domainId: "network",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: {
        ...presentationCapabilities,
        structuredDiff: false,
      },
      selfHostedDurableDecision: false,
      label: "Wrong capabilities",
      description: "This presentation contradicts the Network runtime.",
    });
    expect(() =>
      defineDomainRegistry([
        {
          runtime: network.entry.runtime,
          presentation: wrongCapabilitiesPresentation,
        },
      ]),
    ).toThrow(/capabilit/i);
  });

  it("rejects presentation attempts to carry policy or workflow authority", () => {
    expect(() =>
      defineDomainPresentation({
        domainId: "network",
        contractVersion: REVIEW_CONTRACT_VERSION,
        domainShape: "simulated-state",
        capabilities: presentationCapabilities,
        selfHostedDurableDecision: false,
        label: "Network",
        description: "Declarative network review.",
        riskLevel: "LOW",
      }),
    ).toThrow();
  });
});
