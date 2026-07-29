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
} from "./runtime";
import {
  defineDomainPresentation,
  type DomainPresentationDefinition,
} from "./presentation";
import {
  IncidentBundleSchema,
  NetworkChangeProposalSchema,
  networkDomain,
  runSimulation,
} from "@changesafe/domain-network";
import {
  TerraformChangeProposalSchema,
  TerraformInputSchema,
  terraformDomain,
} from "@changesafe/domain-terraform";
import {
  KubernetesChangeProposalSchema,
  KubernetesSnapshotSchema,
  kubernetesDomain,
  runKubernetesSimulation,
} from "@changesafe/domain-kubernetes";

export interface DomainRegistryEntry {
  readonly runtime: DomainRuntimeDefinition;
  readonly presentation: DomainPresentationDefinition;
}

export interface DomainRegistryResolution {
  readonly ok: true;
  readonly entry: DomainRegistryEntry;
}

export interface DomainRegistry {
  readonly entries: readonly DomainRegistryEntry[];
  resolve(
    domainId: string,
    contractVersion: string,
  ): DomainRegistryResolution | ReviewContractErrorResult;
}

const capabilityKeys: readonly (keyof DomainStaticCapabilities)[] = [
  "sandboxSimulation",
  "resourceGraph",
  "structuredDiff",
  "untrustedContext",
];

export function defineDomainRegistry(
  rawEntries: readonly DomainRegistryEntry[],
): DomainRegistry {
  const domainIds = new Set<string>();
  const entries = Object.freeze(
    rawEntries.map((entry) => {
      assertDefinitionsAgree(entry);
      if (domainIds.has(entry.runtime.domainId)) {
        throw new Error(`duplicate runtime domain "${entry.runtime.domainId}"`);
      }
      domainIds.add(entry.runtime.domainId);
      return Object.freeze(entry);
    }),
  );

  return Object.freeze({
    entries,
    resolve(
      domainId: string,
      contractVersion: string,
    ): DomainRegistryResolution | ReviewContractErrorResult {
      const entry = entries.find(
        (candidate) => candidate.runtime.domainId === domainId,
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
      if (contractVersion !== entry.runtime.contractVersion) {
        return ReviewContractErrorResultSchema.parse({
          ok: false,
          error: {
            code: "CONTRACT_VERSION_MISMATCH",
            domainId,
            expectedContractVersion: entry.runtime.contractVersion,
            receivedContractVersion: contractVersion,
          },
        });
      }
      return { ok: true, entry };
    },
  });
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

const networkRuntime = defineSimulatedRuntime({
  domainId: "network",
  contractVersion: REVIEW_CONTRACT_VERSION,
  capabilities: networkCapabilities,
  inputSchema: IncidentBundleSchema,
  proposalSchema: NetworkChangeProposalSchema,
  adapter: networkDomain,
  simulate: runSimulation,
});

const terraformRuntime = defineExternalDiffRuntime({
  domainId: "terraform",
  contractVersion: REVIEW_CONTRACT_VERSION,
  capabilities: terraformCapabilities,
  inputSchema: TerraformInputSchema,
  proposalSchema: TerraformChangeProposalSchema,
  adapter: terraformDomain,
});

const kubernetesRuntime = defineSimulatedRuntime({
  domainId: "kubernetes",
  contractVersion: REVIEW_CONTRACT_VERSION,
  capabilities: kubernetesCapabilities,
  inputSchema: KubernetesSnapshotSchema,
  proposalSchema: KubernetesChangeProposalSchema,
  adapter: kubernetesDomain,
  simulate: runKubernetesSimulation,
});

export const DOMAIN_REGISTRY = defineDomainRegistry([
  {
    runtime: networkRuntime,
    presentation: defineDomainPresentation({
      domainId: "network",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: networkCapabilities,
      label: "Network",
      description:
        "Review declarative network incident proposals against deterministic policies and sandbox simulation.",
    }),
  },
  {
    runtime: terraformRuntime,
    presentation: defineDomainPresentation({
      domainId: "terraform",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "external-diff",
      capabilities: terraformCapabilities,
      label: "Terraform",
      description:
        "Review supplied Terraform plan diffs without running Terraform or pretending to simulate them.",
    }),
  },
  {
    runtime: kubernetesRuntime,
    presentation: defineDomainPresentation({
      domainId: "kubernetes",
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainShape: "simulated-state",
      capabilities: kubernetesCapabilities,
      label: "Kubernetes",
      description:
        "Review offline Kubernetes snapshots and proposed manifests through an in-memory sandbox.",
    }),
  },
]);
