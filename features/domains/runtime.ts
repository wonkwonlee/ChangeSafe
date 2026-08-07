import { z } from "zod";
import {
  computePolicyCoverage,
  evaluatePolicies,
  validateProposalEvidence,
  PolicyPackSchema,
  resolvePolicyPack,
  type ChangeProposal,
  type DomainAdapter,
  type PolicyEvaluation,
  type ResolvedPolicyPack,
  type SimulationResult,
  type SkippedUniversalPolicy,
} from "@changesafe/core";

import {
  REVIEW_CONTRACT_VERSION,
  DomainIdSchema,
  ReviewCapabilitiesSchema,
  ReviewRuntimeModeSchema,
  type DomainId,
  type ReviewCapabilities,
  type ReviewRuntimeMode,
} from "./review-contract";

export const DomainStaticCapabilitiesSchema = ReviewCapabilitiesSchema.omit({
  durableDecision: true,
});

export type DomainStaticCapabilities = Readonly<
  z.infer<typeof DomainStaticCapabilitiesSchema>
>;

const transportCapabilityBrand: unique symbol = Symbol(
  "changesafe.transport-capabilities",
);

export interface TransportCapabilitySource {
  readonly durableDecision: boolean;
  readonly [transportCapabilityBrand]: true;
}

const TransportCapabilitySourceSchema = z.strictObject({
  durableDecision: z.boolean(),
});

export function defineTransportCapabilitySource(
  rawSource: unknown,
): TransportCapabilitySource {
  const parsed = TransportCapabilitySourceSchema.parse(rawSource);
  const source: TransportCapabilitySource = {
    durableDecision: parsed.durableDecision,
    [transportCapabilityBrand]: true,
  };
  return Object.freeze(source);
}

const RuntimeMetadataSchema = z.strictObject({
  domainId: DomainIdSchema,
  contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
  capabilities: DomainStaticCapabilitiesSchema,
});

const ResolvedPolicyPackSchema = z.strictObject({
  blastRadius: z.strictObject({
    warnAt: z.number().int().min(1).max(1000),
    blockAbove: z.number().int().min(1).max(1000),
  }),
  verification: z.strictObject({
    requirePrecondition: z.boolean(),
    requirePostcheck: z.boolean(),
  }),
});

export interface RuntimePolicyCoverage {
  readonly orderedPolicyIds: readonly string[];
  readonly skippedPolicies: readonly SkippedUniversalPolicy[];
  readonly baselinePack: Readonly<{
    source: "core-default" | "domain-default";
    name: string;
    parameters: Readonly<ResolvedPolicyPack>;
  }>;
  readonly limitations: readonly string[];
}

export interface RuntimeCapabilitySource {
  readonly capabilities: DomainStaticCapabilities;
}

interface RuntimeDefinitionBase extends RuntimeCapabilitySource {
  readonly domainId: DomainId;
  readonly contractVersion: typeof REVIEW_CONTRACT_VERSION;
  /** The exact deterministic policy set used by this runtime. */
  readonly policyVersion: string;
  /** Loaded policy evidence. Registered presentation metadata never guesses this. */
  readonly policyCoverage: RuntimePolicyCoverage;
  evaluate(rawInput: unknown, rawProposal: unknown): PolicyEvaluation;
}

export interface SimulatedRuntimeDefinition extends RuntimeDefinitionBase {
  readonly domainShape: "simulated-state";
  simulate(rawInput: unknown, rawProposal: unknown): SimulationResult;
}

export interface ExternalDiffRuntimeDefinition extends RuntimeDefinitionBase {
  readonly domainShape: "external-diff";
}

export type DomainRuntimeDefinition =
  | SimulatedRuntimeDefinition
  | ExternalDiffRuntimeDefinition;

interface RuntimeConfig<
  TInput,
  TState,
  TProposal extends ChangeProposal,
> {
  readonly domainId: DomainId;
  readonly contractVersion: typeof REVIEW_CONTRACT_VERSION;
  readonly capabilities: DomainStaticCapabilities;
  readonly inputSchema: z.ZodType<TInput>;
  readonly proposalSchema: z.ZodType<TProposal>;
  readonly adapter: DomainAdapter<TInput, TState>;
  readonly limitations?: readonly string[];
}

interface SimulatedRuntimeConfig<
  TInput,
  TState,
  TProposal extends ChangeProposal,
> extends RuntimeConfig<TInput, TState, TProposal> {
  readonly simulate: (input: TInput, proposal: TProposal) => SimulationResult;
}

export function defineSimulatedRuntime<
  TInput,
  TState,
  TProposal extends ChangeProposal,
>(
  config: SimulatedRuntimeConfig<TInput, TState, TProposal>,
): SimulatedRuntimeDefinition {
  const metadata = validateRuntimeMetadata(config, "simulated-state");
  return Object.freeze({
    ...metadata,
    domainShape: "simulated-state",
    evaluate(rawInput: unknown, rawProposal: unknown) {
      const { input, proposal } = parseBoundary(config, rawInput, rawProposal);
      return evaluatePolicies(config.adapter, input, proposal);
    },
    simulate(rawInput: unknown, rawProposal: unknown) {
      const { input, proposal } = parseBoundary(config, rawInput, rawProposal);
      return config.simulate(input, proposal);
    },
  });
}

export function defineExternalDiffRuntime<
  TInput,
  TState,
  TProposal extends ChangeProposal,
>(
  config: RuntimeConfig<TInput, TState, TProposal>,
): ExternalDiffRuntimeDefinition {
  const metadata = validateRuntimeMetadata(config, "external-diff");
  return Object.freeze({
    ...metadata,
    domainShape: "external-diff",
    evaluate(rawInput: unknown, rawProposal: unknown) {
      const { input, proposal } = parseBoundary(config, rawInput, rawProposal);
      return evaluatePolicies(config.adapter, input, proposal);
    },
  });
}

export function composeSessionCapabilities(
  source: RuntimeCapabilitySource,
  rawRuntimeMode: ReviewRuntimeMode,
  transport: TransportCapabilitySource,
): Readonly<ReviewCapabilities> {
  const runtimeMode = ReviewRuntimeModeSchema.parse(rawRuntimeMode);
  if (transport[transportCapabilityBrand] !== true) {
    throw new Error("session capabilities require a validated transport capability source");
  }
  const capabilities = ReviewCapabilitiesSchema.parse({
    ...source.capabilities,
    durableDecision: runtimeMode === "self-hosted" && transport.durableDecision,
  });
  return Object.freeze({ ...capabilities });
}

function validateRuntimeMetadata<
  TInput,
  TState,
  TProposal extends ChangeProposal,
>(
  config: RuntimeConfig<TInput, TState, TProposal>,
  domainShape: "simulated-state" | "external-diff",
) {
  const metadata = RuntimeMetadataSchema.parse({
    domainId: config.domainId,
    contractVersion: config.contractVersion,
    capabilities: config.capabilities,
  });
  if (metadata.domainId !== config.adapter.domainId) {
    throw new Error(
      `runtime domain "${metadata.domainId}" does not match adapter domain "${config.adapter.domainId}"`,
    );
  }
  const policyVersion = z.string().min(1).max(32).parse(
    config.adapter.policyVersion,
  );
  const policyCoverage = defineRuntimePolicyCoverage(config);
  if (
    metadata.capabilities.sandboxSimulation !==
    (domainShape === "simulated-state")
  ) {
    throw new Error(
      `${domainShape} runtimes must advertise exactly their sandbox simulation behavior`,
    );
  }
  return {
    ...metadata,
    policyVersion,
    policyCoverage,
    capabilities: Object.freeze({ ...metadata.capabilities }),
  };
}

function defineRuntimePolicyCoverage<
  TInput,
  TState,
  TProposal extends ChangeProposal,
>(
  config: RuntimeConfig<TInput, TState, TProposal>,
): RuntimePolicyCoverage {
  // `computePolicyCoverage` is core's own authority on what a gate run for
  // this adapter actually produces: it throws for a skip that names a
  // policy the adapter never declares, a duplicate skip, or an attempt to
  // skip anything other than the two policies core allows skipping. A
  // runtime registered here gets the identical guarantee `changesafe gate`
  // gets against the same adapter — this function no longer re-derives it.
  const coverage = computePolicyCoverage(config.adapter);
  const skippedPolicies = coverage.skippedPolicies.map((skip) => Object.freeze({ ...skip }));

  const orderedPolicyIds = coverage.orderedPolicyIds.map((policyId) =>
    z.string().min(1).max(128).parse(policyId),
  );
  if (new Set(orderedPolicyIds).size !== orderedPolicyIds.length) {
    throw new Error(
      `runtime domain "${config.domainId}" declares duplicate policy ids`,
    );
  }

  const baselinePack =
    config.adapter.defaultPolicyPack === undefined
      ? undefined
      : PolicyPackSchema.parse(config.adapter.defaultPolicyPack);
  const baselineParameters = ResolvedPolicyPackSchema.parse(
    resolvePolicyPack(baselinePack),
  );
  const limitations = (config.limitations ?? []).map((limitation) =>
    z.string().min(1).max(1000).parse(limitation),
  );

  return Object.freeze({
    orderedPolicyIds: Object.freeze(orderedPolicyIds),
    skippedPolicies: Object.freeze(skippedPolicies),
    baselinePack: Object.freeze({
      source: baselinePack ? "domain-default" : "core-default",
      name:
        baselinePack?.name ??
        (baselinePack ? "Unnamed domain defaults" : "ChangeSafe core defaults"),
      parameters: Object.freeze({
        blastRadius: Object.freeze({
          ...baselineParameters.blastRadius,
        }),
        verification: Object.freeze({
          ...baselineParameters.verification,
        }),
      }),
    }),
    limitations: Object.freeze(limitations),
  });
}

function parseBoundary<
  TInput,
  TState,
  TProposal extends ChangeProposal,
>(
  config: RuntimeConfig<TInput, TState, TProposal>,
  rawInput: unknown,
  rawProposal: unknown,
): { input: TInput; proposal: TProposal } {
  const input = config.inputSchema.parse(rawInput);
  const proposal = config.proposalSchema.parse(rawProposal);
  validateProposalEvidence(config.adapter, input, proposal);
  return { input, proposal };
}
