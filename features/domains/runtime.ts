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
  type DomainId,
  type ReviewCapabilities,
} from "./review-contract";

const RuntimeMetadataSchema = z.strictObject({
  domainId: DomainIdSchema,
  contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
  capabilities: ReviewCapabilitiesSchema,
});

interface RuntimeDefinitionBase {
  readonly domainId: DomainId;
  readonly contractVersion: typeof REVIEW_CONTRACT_VERSION;
  readonly capabilities: ReviewCapabilities;
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
  readonly capabilities: ReviewCapabilities;
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
  if (domainShape === "external-diff" && metadata.capabilities.sandboxSimulation) {
    throw new Error("external-diff runtimes cannot advertise sandbox simulation");
  }
  return metadata;
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
