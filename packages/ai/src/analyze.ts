import { DomainError, isDomainError, type ChangeProposal } from "@changesafe/core";

import { toPortableJsonSchema } from "./json-schema";
import type { AnalysisPrompt } from "./prompt";
import { notConfigured, type ModelProvider, type ProviderId } from "./provider";
import { resolveModel } from "./registry";

/** Generous enough for a full proposal with rollback; not so large that a
 *  runaway response costs real money before it is rejected. */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

export interface AnalyzeOptions {
  readonly provider: ModelProvider;
  /** Overrides the provider default and any env override. */
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Injected so tests exercise real adapters without network access. */
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  /** Per-call transport bounds; a local Ollama model may legitimately need
   *  longer than the shared default. */
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface AnalysisResult {
  readonly proposal: ChangeProposal;
  readonly provider: ProviderId;
  /** What actually answered — not what was requested. */
  readonly model: string;
}

/**
 * Why a proposal was or was not accepted.
 *
 * The failure modes are kept apart because they say different things about a
 * model, and collapsing them would make a model-comparison report misleading:
 * `call_failed` is an infrastructure problem and no evidence about the model
 * at all; `no_output` means the provider returned nothing usable (truncation,
 * refusal); `schema_invalid` means the model could not produce the required
 * shape; and `ungrounded` means it produced a well-formed, confident proposal
 * about things that do not exist — the most dangerous failure, and the one a
 * schema cannot catch.
 */
export type ProposalVerdict =
  | { readonly outcome: "accepted"; readonly proposal: ChangeProposal; readonly model: string }
  | { readonly outcome: "call_failed"; readonly detail: string; readonly error: DomainError }
  | {
      readonly outcome: "no_output";
      readonly model: string;
      readonly detail: string;
      readonly error: DomainError;
    }
  | {
      readonly outcome: "schema_invalid";
      readonly model: string;
      readonly detail: string;
      readonly error: DomainError;
    }
  | {
      readonly outcome: "ungrounded";
      readonly model: string;
      readonly detail: string;
      readonly error: DomainError;
    };

/** Outcomes that mean the model answered but the answer was not acceptable. */
export const REJECTED_OUTCOMES = ["no_output", "schema_invalid", "ungrounded"] as const;

/**
 * Ask a provider for one proposal and classify the result without throwing.
 *
 * Every provider runs this identical path. There is no provider-specific
 * leniency, no "trusted provider" fast path, and no way for a provider to
 * signal that its output needs less checking.
 */
export async function probeProposal<TInput>(
  prompt: AnalysisPrompt<TInput>,
  input: TInput,
  options: AnalyzeOptions,
): Promise<ProposalVerdict> {
  const env = options.env ?? process.env;
  const provider = options.provider;

  // A caller supplying a transport is driving the adapter directly (tests,
  // proxies); credentials are then that caller's business.
  if (!options.fetch && !provider.isConfigured(env)) {
    throw notConfigured(provider);
  }

  const model = resolveModel(provider, env, options.model);

  let raw: unknown;
  let answeringModel = model;
  try {
    const result = await provider.propose(
      {
        model,
        systemInstructions: prompt.systemInstructions,
        userContent: prompt.buildUserContent(input),
        schemaName: prompt.schemaName,
        jsonSchema: toPortableJsonSchema(prompt.proposalSchema),
        maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      },
      {
        fetch: options.fetch ?? globalThis.fetch,
        env,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxResponseBytes: options.maxResponseBytes,
      },
    );
    raw = result.data;
    answeringModel = result.model;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // The provider answered, but with nothing usable — distinct from the
    // model producing a wrong shape.
    if (error.code === "AI_INVALID_OUTPUT") {
      return { outcome: "no_output", model, detail: error.userMessage, error };
    }
    return { outcome: "call_failed", detail: error.userMessage, error };
  }

  // Structured output constrains generation; it does not make the result
  // true. Parsing with the full Zod schema restores every constraint the
  // portable wire schema had to drop.
  const parsed = prompt.proposalSchema.safeParse(raw);
  if (!parsed.success) {
    const error = new DomainError(
      "AI_INVALID_OUTPUT",
      "The model returned output that does not match the ChangeProposal schema. No proposal was accepted.",
    );
    return { outcome: "schema_invalid", model: answeringModel, detail: error.userMessage, error };
  }

  try {
    prompt.crossCheck(input, parsed.data);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return {
      outcome: "ungrounded",
      model: answeringModel,
      detail: error.userMessage,
      error,
    };
  }

  return { outcome: "accepted", proposal: parsed.data, model: answeringModel };
}

/**
 * Ask a provider for one proposal and accept it only if it survives local
 * validation. Rejection is a typed error; no partial proposal escapes.
 */
export async function analyzeWithPrompt<TInput>(
  prompt: AnalysisPrompt<TInput>,
  input: TInput,
  options: AnalyzeOptions,
): Promise<AnalysisResult> {
  const verdict = await probeProposal(prompt, input, options);
  if (verdict.outcome !== "accepted") {
    // Rethrow the original typed error so callers keep the specific code and
    // message the failure actually produced.
    throw verdict.error;
  }
  return {
    proposal: verdict.proposal,
    provider: options.provider.id,
    model: verdict.model,
  };
}
