import { DomainError } from "@changesafe/core";

import { isProviderId, PROVIDER_IDS, type ModelProvider, type ProviderId } from "./provider";
import { anthropicProvider } from "./providers/anthropic";
import { ollamaProvider } from "./providers/ollama";
import { openaiProvider } from "./providers/openai";

const PROVIDERS: Record<ProviderId, ModelProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
};

export const ALL_PROVIDERS: readonly ModelProvider[] = PROVIDER_IDS.map((id) => PROVIDERS[id]);

export function resolveProvider(id: string): ModelProvider {
  if (!isProviderId(id)) {
    throw new DomainError(
      "REQUEST_INVALID",
      `Unknown provider "${id}". Available: ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  return PROVIDERS[id];
}

/**
 * The provider a deployment offers for live analysis.
 *
 * `CHANGESAFE_PROVIDER` names it explicitly. Absent that, a configured hosted
 * provider is chosen so an existing single-key deployment keeps working, and
 * OpenAI wins ties only because it was the original integration. Ollama is
 * never selected implicitly: it always appears reachable, so defaulting to it
 * would turn "no credentials" into a confusing connection error instead of an
 * honest "live mode is not configured".
 */
export function defaultProvider(
  env: Readonly<Record<string, string | undefined>>,
): ModelProvider | null {
  const named = env.CHANGESAFE_PROVIDER;
  if (named) return resolveProvider(named);

  for (const provider of [openaiProvider, anthropicProvider]) {
    if (provider.isConfigured(env)) return provider;
  }
  return null;
}

/** The model to use for a provider: explicit request, env override, or default. */
export function resolveModel(
  provider: ModelProvider,
  env: Readonly<Record<string, string | undefined>>,
  requested?: string,
): string {
  if (requested) return requested;
  const override = env[`CHANGESAFE_${provider.id.toUpperCase()}_MODEL`];
  return override ?? provider.defaultModel;
}
