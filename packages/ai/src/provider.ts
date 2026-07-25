import { DomainError } from "@changesafe/core";

import type { JsonSchema } from "./json-schema";

/**
 * The provider contract.
 *
 * A provider turns a prompt plus a JSON Schema into one candidate object. It
 * is deliberately the narrowest possible surface: no streaming, no tools, no
 * conversation. Everything a provider returns is untrusted data that must
 * still pass local validation, so a provider cannot earn trust by being
 * well-known — the OpenAI adapter and a laptop-local Ollama adapter face
 * exactly the same downstream checks.
 *
 * All providers speak plain HTTP through an injected `fetch`. No vendor SDKs:
 * that keeps the bundled CLI free of third-party dependencies and lets every
 * test drive a real adapter with a stub transport instead of a mock.
 */

export const PROVIDER_IDS = ["openai", "anthropic", "ollama"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export interface ProposalRequest {
  readonly model: string;
  /** Trusted instructions. Never contains incident content. */
  readonly systemInstructions: string;
  /** Untrusted content, already wrapped in data delimiters by the prompt. */
  readonly userContent: string;
  readonly schemaName: string;
  readonly jsonSchema: JsonSchema;
  readonly maxOutputTokens: number;
}

export interface ProviderCall {
  /** Injected so tests exercise real adapters without network access. */
  readonly fetch: typeof globalThis.fetch;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
}

export interface ProviderResult {
  /** Parsed JSON exactly as the provider returned it. Not yet validated. */
  readonly data: unknown;
  /** The model the provider reports having answered with, when it says. */
  readonly model: string;
}

export interface ModelProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly defaultModel: string;
  /** Environment variable holding the credential; null when the provider is
   *  local and needs none. */
  readonly credentialEnvVar: string | null;
  isConfigured(env: Readonly<Record<string, string | undefined>>): boolean;
  propose(request: ProposalRequest, call: ProviderCall): Promise<ProviderResult>;
}

/**
 * Collapse any transport or provider failure into a typed error carrying only
 * the provider and HTTP status. Request bodies, response bodies, headers, and
 * credentials never reach a user-visible message; the original is preserved
 * on `cause` for local debugging only.
 */
export function callFailed(
  provider: ModelProvider,
  detail: string,
  cause?: unknown,
): DomainError {
  return new DomainError(
    "AI_CALL_FAILED",
    `The ${provider.label} analysis call failed (${detail}). You can retry, choose another provider, or use replay mode.`,
    { cause },
  );
}

/** The provider answered, but not with a usable structured object. */
export function invalidOutput(provider: ModelProvider, detail: string): DomainError {
  return new DomainError(
    "AI_INVALID_OUTPUT",
    `${provider.label} did not return a complete structured proposal (${detail}). No proposal was accepted.`,
  );
}

export function notConfigured(provider: ModelProvider): DomainError {
  return new DomainError(
    "AI_UNAVAILABLE",
    provider.credentialEnvVar
      ? `${provider.label} is not configured: set ${provider.credentialEnvVar}. Replay mode needs no credentials.`
      : `${provider.label} is not reachable. Replay mode needs no credentials.`,
  );
}

/** POST JSON and return the decoded body, mapping every failure to a safe error. */
export async function postJson(
  provider: ModelProvider,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  call: ProviderCall,
): Promise<unknown> {
  let response: Response;
  try {
    response = await call.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: call.signal,
    });
  } catch (error) {
    throw callFailed(provider, "the request could not be sent", error);
  }

  if (!response.ok) {
    // Only the status crosses the boundary — provider error bodies can echo
    // the request, and the request contains untrusted incident content.
    throw callFailed(provider, `upstream status ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw callFailed(provider, "the response was not valid JSON", error);
  }
}

/** Parse a JSON string a provider returned as text, without leaking its content. */
export function parseJsonText(provider: ModelProvider, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidOutput(provider, "the returned text was not valid JSON");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
