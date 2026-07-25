import {
  analyzeWithPrompt,
  defaultProvider,
  networkAnalysisPrompt,
  resolveModel,
  type ModelProvider,
} from "@changesafe/ai";
import { DomainError, type ChangeProposal } from "@changesafe/core";
import { type IncidentBundle } from "@changesafe/domain-network";

// Server-only module: credentials must never reach the browser.
if (typeof window !== "undefined") {
  throw new Error("lib/ai/live is server-only and must never be imported by client code");
}

export interface LiveAnalysis {
  proposal: ChangeProposal;
  /** The model that actually answered, as the provider reported it. */
  model: string;
  provider: string;
}

/** The provider this deployment is configured to call, or null for none. */
export function liveProvider(): ModelProvider | null {
  return defaultProvider(process.env);
}

export function isLiveConfigured(): boolean {
  return liveProvider() !== null;
}

/**
 * What the console may advertise about live mode: a provider and the model it
 * would be asked for. Never a credential, and never a claim that a call will
 * succeed — only an attempt can establish that.
 */
export function liveProviderInfo(): { provider: string; model: string } | null {
  const provider = liveProvider();
  if (!provider) return null;
  return { provider: provider.id, model: resolveModel(provider, process.env) };
}

/**
 * Live analysis through whichever provider this deployment configured.
 *
 * The bundle rides inside untrusted-data delimiters and the returned object is
 * accepted only after local validation (schema, evidence ids, device refs).
 * Which provider answered changes none of that.
 */
export async function analyzeLive(
  bundle: IncidentBundle,
  options: { fetch?: typeof globalThis.fetch; provider?: ModelProvider } = {},
): Promise<LiveAnalysis> {
  const provider = options.provider ?? liveProvider();
  if (!provider) {
    throw new DomainError(
      "AI_UNAVAILABLE",
      "Live mode is not configured on this server. Replay mode is available.",
    );
  }

  const result = await analyzeWithPrompt(networkAnalysisPrompt, bundle, {
    provider,
    fetch: options.fetch,
  });

  return { proposal: result.proposal, model: result.model, provider: result.provider };
}
