import {
  type ReviewContractErrorResult,
  REVIEW_CONTRACT_VERSION,
  ReviewContractErrorResultSchema,
} from "./review-contract";
import {
  defineExternalDiffRuntime,
  defineSimulatedRuntime,
  type DomainStaticCapabilities,
  type DomainRuntimeDefinition,
  type RuntimePolicyCoverage,
} from "./runtime";
import {
  defineDomainPresentation,
  type DomainPresentationDefinition,
} from "./presentation";

export interface DomainRegistryEntry {
  readonly runtime: DomainRuntimeDefinition;
  readonly presentation: DomainPresentationDefinition;
}

export interface LazyDomainRegistryEntry {
  readonly metadata: DomainPresentationDefinition;
  load(): Promise<DomainRegistryEntry>;
}

export interface DomainRegistryResolution {
  readonly ok: true;
  readonly metadata: DomainPresentationDefinition;
  load(): Promise<DomainRegistryEntry>;
}

export interface DomainRegistry {
  readonly entries: readonly DomainPresentationDefinition[];
  resolve(
    domainId: string,
    contractVersion: string,
  ): DomainRegistryResolution | ReviewContractErrorResult;
}

export interface LoadedDomainCoverageCatalog {
  readonly registration: DomainPresentationDefinition;
  readonly runtime: Readonly<{
    domainId: string;
    contractVersion: typeof REVIEW_CONTRACT_VERSION;
    domainShape: DomainRuntimeDefinition["domainShape"];
    policyVersion: string;
    capabilities: DomainStaticCapabilities;
    policyCoverage: RuntimePolicyCoverage;
  }>;
}

const capabilityKeys: readonly (keyof DomainStaticCapabilities)[] = [
  "sandboxSimulation",
  "resourceGraph",
  "structuredDiff",
  "untrustedContext",
];

export function defineDomainRegistry(
  rawEntries: readonly LazyDomainRegistryEntry[],
): DomainRegistry {
  const domainIds = new Set<string>();
  const entries = rawEntries.map((rawEntry) => {
    const metadata = defineDomainPresentation(rawEntry.metadata);
    if (domainIds.has(metadata.domainId)) {
      throw new Error(`duplicate runtime domain "${metadata.domainId}"`);
    }
    domainIds.add(metadata.domainId);

    let loadedEntry: Promise<DomainRegistryEntry> | null = null;
    const load = () => {
      loadedEntry ??= rawEntry.load().then((entry) =>
        validateLoadedEntry(metadata, entry),
      );
      return loadedEntry;
    };
    return Object.freeze({ metadata, load });
  });
  const frozenEntries = Object.freeze(entries);

  return Object.freeze({
    entries: Object.freeze(frozenEntries.map((entry) => entry.metadata)),
    resolve(
      domainId: string,
      contractVersion: string,
    ): DomainRegistryResolution | ReviewContractErrorResult {
      const entry = frozenEntries.find(
        (candidate) => candidate.metadata.domainId === domainId,
      );
      if (!entry) {
        return ReviewContractErrorResultSchema.parse({
          ok: false,
          error: {
            code: "UNKNOWN_DOMAIN",
            domainId,
          },
        });
      }
      if (contractVersion !== entry.metadata.contractVersion) {
        return ReviewContractErrorResultSchema.parse({
          ok: false,
          error: {
            code: "CONTRACT_VERSION_MISMATCH",
            domainId,
            expectedContractVersion: entry.metadata.contractVersion,
            receivedContractVersion: contractVersion,
          },
        });
      }
      return {
        ok: true,
        metadata: entry.metadata,
        load: entry.load,
      };
    },
  });
}

/**
 * Load deterministic policy evidence for one already-registered domain.
 *
 * Registry metadata remains available without importing a domain package.
 * Calling this helper is the explicit boundary that loads one runtime and
 * turns registered capability claims into inspectable policy coverage.
 */
export async function loadDomainCoverageCatalog(
  domainId: string,
): Promise<LoadedDomainCoverageCatalog> {
  const resolution = DOMAIN_REGISTRY.resolve(
    domainId,
    REVIEW_CONTRACT_VERSION,
  );
  if (!resolution.ok) {
    throw new Error(`registered domain "${domainId}" is unavailable`);
  }
  const { runtime } = await resolution.load();
  return Object.freeze({
    registration: resolution.metadata,
    runtime: Object.freeze({
      domainId: runtime.domainId,
      contractVersion: runtime.contractVersion,
      domainShape: runtime.domainShape,
      policyVersion: runtime.policyVersion,
      capabilities: runtime.capabilities,
      policyCoverage: runtime.policyCoverage,
    }),
  });
}

function validateLoadedEntry(
  metadata: DomainPresentationDefinition,
  entry: DomainRegistryEntry,
): DomainRegistryEntry {
  assertDefinitionsAgree(entry);
  const { runtime, presentation } = entry;
  if (
    runtime.domainId !== metadata.domainId ||
    runtime.contractVersion !== metadata.contractVersion ||
    runtime.domainShape !== metadata.domainShape ||
    presentation.label !== metadata.label ||
    presentation.description !== metadata.description ||
    capabilityKeys.some(
      (capability) =>
        runtime.capabilities[capability] !== metadata.capabilities[capability],
    )
  ) {
    throw new Error(
      `loaded definitions disagree with registered metadata for "${metadata.domainId}"`,
    );
  }
  return Object.freeze({ runtime, presentation });
}

function assertDefinitionsAgree(entry: DomainRegistryEntry): void {
  const { runtime, presentation } = entry;
  const hasSimulation =
    "simulate" in runtime && typeof runtime.simulate === "function";
  if (
    runtime.capabilities.sandboxSimulation !== hasSimulation ||
    (runtime.domainShape === "simulated-state") !== hasSimulation
  ) {
    throw new Error(
      `runtime shape, sandbox capability, and simulate availability disagree for "${runtime.domainId}"`,
    );
  }
  if (runtime.domainId !== presentation.domainId) {
    throw new Error(
      `runtime domain "${runtime.domainId}" does not match presentation domain "${presentation.domainId}"`,
    );
  }
  if (runtime.contractVersion !== presentation.contractVersion) {
    throw new Error(
      `runtime contract "${runtime.contractVersion}" does not match presentation contract "${presentation.contractVersion}"`,
    );
  }
  if (runtime.domainShape !== presentation.domainShape) {
    throw new Error(
      `runtime shape "${runtime.domainShape}" does not match presentation shape "${presentation.domainShape}"`,
    );
  }
  if (
    capabilityKeys.some(
      (capability) =>
        runtime.capabilities[capability] !==
        presentation.capabilities[capability],
    )
  ) {
    throw new Error(
      `runtime and presentation capabilities disagree for "${runtime.domainId}"`,
    );
  }
}

const networkCapabilities = {
  sandboxSimulation: true,
  resourceGraph: true,
  structuredDiff: true,
  untrustedContext: true,
} satisfies DomainStaticCapabilities;

const terraformCapabilities = {
  sandboxSimulation: false,
  resourceGraph: false,
  structuredDiff: true,
  untrustedContext: true,
} satisfies DomainStaticCapabilities;

const kubernetesCapabilities = {
  sandboxSimulation: true,
  resourceGraph: true,
  structuredDiff: true,
  untrustedContext: true,
} satisfies DomainStaticCapabilities;

const networkMetadata = {
  domainId: "network",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "simulated-state",
  capabilities: networkCapabilities,
  label: "Network",
  description:
    "Review declarative network incident proposals against deterministic policies and sandbox simulation.",
} as const;

const terraformMetadata = {
  domainId: "terraform",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "external-diff",
  capabilities: terraformCapabilities,
  label: "Terraform",
  description:
    "Review supplied Terraform plan diffs without running Terraform or pretending to simulate them.",
} as const;

const kubernetesMetadata = {
  domainId: "kubernetes",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "simulated-state",
  capabilities: kubernetesCapabilities,
  label: "Kubernetes",
  description:
    "Review offline Kubernetes snapshots and proposed manifests through an in-memory sandbox.",
} as const;

export const DOMAIN_REGISTRY = defineDomainRegistry([
  {
    metadata: defineDomainPresentation(networkMetadata),
    async load() {
      const {
        IncidentBundleSchema,
        NetworkChangeProposalSchema,
        networkDomain,
        runSimulation,
      } = await import("@changesafe/domain-network");
      return {
        runtime: defineSimulatedRuntime({
          domainId: "network",
          contractVersion: REVIEW_CONTRACT_VERSION,
          capabilities: networkCapabilities,
          inputSchema: IncidentBundleSchema,
          proposalSchema: NetworkChangeProposalSchema,
          adapter: networkDomain,
          simulate: runSimulation,
          limitations: [
            "Evaluates declarative Network artifacts only; it never contacts or executes against network infrastructure.",
          ],
        }),
        presentation: defineDomainPresentation(networkMetadata),
      };
    },
  },
  {
    metadata: defineDomainPresentation(terraformMetadata),
    async load() {
      const {
        TerraformChangeProposalSchema,
        TerraformInputSchema,
        terraformDomain,
      } = await import("@changesafe/domain-terraform");
      return {
        runtime: defineExternalDiffRuntime({
          domainId: "terraform",
          contractVersion: REVIEW_CONTRACT_VERSION,
          capabilities: terraformCapabilities,
          inputSchema: TerraformInputSchema,
          proposalSchema: TerraformChangeProposalSchema,
          adapter: terraformDomain,
          limitations: [
            "Consumes a supplied Terraform plan as an external diff; Terraform execution is outside this runtime and unsupported.",
            "Sandbox simulation is unavailable because the domain has no mutable declarative state inside ChangeSafe.",
          ],
        }),
        presentation: defineDomainPresentation(terraformMetadata),
      };
    },
  },
  {
    metadata: defineDomainPresentation(kubernetesMetadata),
    async load() {
      const {
        KubernetesChangeProposalSchema,
        KubernetesSnapshotSchema,
        kubernetesDomain,
        runKubernetesSimulation,
      } = await import("@changesafe/domain-kubernetes/offline");
      return {
        runtime: defineSimulatedRuntime({
          domainId: "kubernetes",
          contractVersion: REVIEW_CONTRACT_VERSION,
          capabilities: kubernetesCapabilities,
          inputSchema: KubernetesSnapshotSchema,
          proposalSchema: KubernetesChangeProposalSchema,
          adapter: kubernetesDomain,
          simulate: runKubernetesSimulation,
          limitations: [
            "Evaluates validated offline snapshots only; it never contacts a Kubernetes API or applies a manifest.",
          ],
        }),
        presentation: defineDomainPresentation(kubernetesMetadata),
      };
    },
  },
]);
