import { describe, expect, expectTypeOf, it } from "vitest";
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
  defineTransportCapabilitySource,
  type DomainStaticCapabilities,
  type TransportCapabilitySource,
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

const durableServerTransport = defineTransportCapabilitySource({
  durableDecision: true,
});

const nonDurableTransport = defineTransportCapabilitySource({
  durableDecision: false,
});

describe("closed domain registry", () => {
  async function loadDomain(domainId: "network" | "terraform" | "kubernetes") {
    const resolution = DOMAIN_REGISTRY.resolve(
      domainId,
      REVIEW_CONTRACT_VERSION,
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      throw new Error(`expected ${domainId} to resolve`);
    }
    expect(resolution.metadata.domainId).toBe(domainId);
    return resolution.load();
  }

  it.each([
    ["network", "simulated-state", true],
    ["terraform", "external-diff", false],
    ["kubernetes", "simulated-state", true],
  ] as const)(
    "resolves the v1 %s runtime and presentation",
    async (domainId, domainShape, hasSimulation) => {
      const entry = await loadDomain(domainId);

      expect(entry.runtime.domainId).toBe(domainId);
      expect(entry.presentation.domainId).toBe(domainId);
      expect(entry.runtime.domainShape).toBe(domainShape);
      expect(entry.presentation.domainShape).toBe(domainShape);
      expect("simulate" in entry.runtime).toBe(hasSimulation);
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

    expect(DOMAIN_REGISTRY.resolve("network", "1.0.0")).toEqual({
      ok: false,
      error: {
        code: "CONTRACT_VERSION_MISMATCH",
        domainId: "network",
        expectedContractVersion: REVIEW_CONTRACT_VERSION,
        receivedContractVersion: "1.0.0",
      },
    });
  });

  it("does not invoke a loader for unknown domains or incompatible versions", () => {
    let loaderCalls = 0;
    const metadata = defineDomainPresentation({
      domainId: "network",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: presentationCapabilities,
      label: "Network",
      description: "Declarative network review.",
    });
    const registry = defineDomainRegistry([
      {
        metadata,
        async load() {
          loaderCalls += 1;
          throw new Error("loader must not run");
        },
      },
    ]);

    expect(registry.resolve("future-domain", REVIEW_CONTRACT_VERSION).ok).toBe(
      false,
    );
    expect(registry.resolve("network", "1.0.0").ok).toBe(false);
    expect(loaderCalls).toBe(0);
  });

  it("keeps Terraform external-diff runtime free of simulation behavior", async () => {
    const entry = await loadDomain("terraform");

    expect(entry.runtime.domainShape).toBe("external-diff");
    expect("simulate" in entry.runtime).toBe(false);
  });

  it.each([
    ["network", "public-replay", durableServerTransport, false],
    ["network", "public-replay", nonDurableTransport, false],
    ["network", "legacy-local", durableServerTransport, false],
    ["network", "self-hosted", durableServerTransport, true],
    ["network", "self-hosted", nonDurableTransport, false],
    ["terraform", "public-replay", durableServerTransport, false],
    ["terraform", "public-replay", nonDurableTransport, false],
    ["terraform", "legacy-local", durableServerTransport, false],
    ["terraform", "self-hosted", durableServerTransport, true],
    ["terraform", "self-hosted", nonDurableTransport, false],
    ["kubernetes", "public-replay", durableServerTransport, false],
    ["kubernetes", "public-replay", nonDurableTransport, false],
    ["kubernetes", "legacy-local", durableServerTransport, false],
    ["kubernetes", "self-hosted", durableServerTransport, true],
    ["kubernetes", "self-hosted", nonDurableTransport, false],
  ] as const)(
    "composes %s durable decision support for %s sessions from transport",
    async (domainId, runtimeMode, transport, durableDecision) => {
      const entry = await loadDomain(domainId);

      expect(
        composeSessionCapabilities(
          entry.runtime,
          runtimeMode,
          transport,
        ),
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

  it("rejects sandbox declarations that contradict runtime shape and behavior", async () => {
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
        label: "Contradictory Network",
        description: "A simulated-state presentation must expose simulation.",
      }),
    ).toThrow(/sandbox/i);

    const [terraform, network] = await Promise.all([
      loadDomain("terraform"),
      loadDomain("network"),
    ]);
    if (network.runtime.domainShape !== "simulated-state") {
      return;
    }
    const contradictoryRuntime = {
      ...terraform.runtime,
      simulate: network.runtime.simulate,
    };
    const contradictoryRegistry = defineDomainRegistry([
      {
        metadata: terraform.presentation,
        async load() {
          return {
            runtime: contradictoryRuntime,
            presentation: terraform.presentation,
          };
        },
      },
    ]);
    const contradiction = contradictoryRegistry.resolve(
      "terraform",
      REVIEW_CONTRACT_VERSION,
    );
    expect(contradiction.ok).toBe(true);
    if (!contradiction.ok) return;
    await expect(
      contradiction.load(),
    ).rejects.toThrow(/sandbox|simulate/i);
  });

  it("copies and freezes capability data so registry definitions cannot drift", async () => {
    const mutableCapabilities = {
      ...presentationCapabilities,
    };
    const presentation = defineDomainPresentation({
      domainId: "network",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: mutableCapabilities,
      label: "Network",
      description: "Declarative network review.",
    });
    mutableCapabilities.structuredDiff = false;

    expect(presentation.capabilities.structuredDiff).toBe(true);
    expect(
      Reflect.set(presentation.capabilities, "structuredDiff", false),
    ).toBe(false);

    const network = await loadDomain("network");
    expect(
      Reflect.set(network.runtime.capabilities, "resourceGraph", false),
    ).toBe(false);
    const composed = composeSessionCapabilities(
      network.runtime,
      "public-replay",
      durableServerTransport,
    );
    expect(Reflect.set(composed, "durableDecision", true)).toBe(false);
    expect(composed).toMatchObject({
      resourceGraph: true,
      durableDecision: false,
    });
  });

  it("rejects runtime and presentation definitions that disagree", async () => {
    const network = await loadDomain("network");

    const wrongDomainPresentation = defineDomainPresentation({
      domainId: "terraform",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: presentationCapabilities,
      label: "Wrong domain",
      description: "This presentation cannot be paired with Network.",
    });
    const wrongDomainRegistry = defineDomainRegistry([
      {
        metadata: wrongDomainPresentation,
        async load() {
          return {
            runtime: network.runtime,
            presentation: wrongDomainPresentation,
          };
        },
      },
    ]);
    const wrongDomain = wrongDomainRegistry.resolve(
      "terraform",
      REVIEW_CONTRACT_VERSION,
    );
    expect(wrongDomain.ok).toBe(true);
    if (!wrongDomain.ok) return;
    await expect(wrongDomain.load()).rejects.toThrow(/domain/i);

    const wrongCapabilitiesPresentation = defineDomainPresentation({
      domainId: "network",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: {
        ...presentationCapabilities,
        structuredDiff: false,
      },
      label: "Wrong capabilities",
      description: "This presentation contradicts the Network runtime.",
    });
    const wrongCapabilitiesRegistry = defineDomainRegistry([
      {
        metadata: wrongCapabilitiesPresentation,
        async load() {
          return {
            runtime: network.runtime,
            presentation: wrongCapabilitiesPresentation,
          };
        },
      },
    ]);
    const wrongCapabilities = wrongCapabilitiesRegistry.resolve(
      "network",
      REVIEW_CONTRACT_VERSION,
    );
    expect(wrongCapabilities.ok).toBe(true);
    if (!wrongCapabilities.ok) return;
    await expect(wrongCapabilities.load()).rejects.toThrow(/capabilit/i);
  });

  it("rejects presentation attempts to carry policy or workflow authority", () => {
    expect(() =>
      defineDomainPresentation({
        domainId: "network",
        contractVersion: REVIEW_CONTRACT_VERSION,
        domainShape: "simulated-state",
        capabilities: presentationCapabilities,
        label: "Network",
        description: "Declarative network review.",
        riskLevel: "LOW",
      }),
    ).toThrow();
  });

  it("keeps durable decision authority out of presentation metadata", () => {
    const presentation = defineDomainPresentation({
      domainId: "network",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: presentationCapabilities,
      label: "Network",
      description: "Declarative network review.",
    });

    expectTypeOf(presentation).not.toMatchTypeOf<TransportCapabilitySource>();
    expect(() =>
      defineDomainPresentation({
        domainId: "network",
        contractVersion: REVIEW_CONTRACT_VERSION,
        domainShape: "simulated-state",
        capabilities: presentationCapabilities,
        durableDecision: true,
        label: "Network",
        description: "Presentation cannot grant durable decisions.",
      }),
    ).toThrow();
    expect(() =>
      defineDomainPresentation({
        domainId: "network",
        contractVersion: REVIEW_CONTRACT_VERSION,
        domainShape: "simulated-state",
        capabilities: presentationCapabilities,
        selfHostedDurableDecision: true,
        label: "Network",
        description: "Presentation cannot grant durable decisions.",
      }),
    ).toThrow();
  });
});
