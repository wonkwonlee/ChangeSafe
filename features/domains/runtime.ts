import { z } from "zod";
import {
  evaluatePolicies,
  type ChangeProposal,
  type DomainAdapter,
  type PolicyEvaluation,
  type SimulationResult,
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

const RuntimeMetadataSchema = z.strictObject({
  domainId: DomainIdSchema,
  contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
  capabilities: DomainStaticCapabilitiesSchema,
  selfHostedDurableDecision: z.boolean(),
});

export interface RuntimeCapabilitySource {
  readonly capabilities: DomainStaticCapabilities;
  readonly selfHostedDurableDecision: boolean;
}

interface RuntimeDefinitionBase extends RuntimeCapabilitySource {
  readonly domainId: DomainId;
  readonly contractVersion: typeof REVIEW_CONTRACT_VERSION;
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
  readonly selfHostedDurableDecision: boolean;
  readonly inputSchema: z.ZodType<TInput>;
  readonly proposalSchema: z.ZodType<TProposal>;
  readonly adapter: DomainAdapter<TInput, TState>;
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
): Readonly<ReviewCapabilities> {
  const runtimeMode = ReviewRuntimeModeSchema.parse(rawRuntimeMode);
  const capabilities = ReviewCapabilitiesSchema.parse({
    ...source.capabilities,
    durableDecision:
      runtimeMode === "self-hosted" && source.selfHostedDurableDecision,
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
    selfHostedDurableDecision: config.selfHostedDurableDecision,
  });
  if (metadata.domainId !== config.adapter.domainId) {
    throw new Error(
      `runtime domain "${metadata.domainId}" does not match adapter domain "${config.adapter.domainId}"`,
    );
  }
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
    capabilities: Object.freeze({ ...metadata.capabilities }),
  };
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
  return { input, proposal };
}
