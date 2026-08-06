import { DomainError, isDomainError } from "@changesafe/core";

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
  /** Overrides {@link DEFAULT_PROVIDER_TIMEOUT_MS}; a slow local model is a
   *  legitimate reason to wait longer than a hosted API should ever need. */
  readonly timeoutMs?: number;
  /** Overrides {@link MAX_PROVIDER_RESPONSE_BYTES}. */
  readonly maxResponseBytes?: number;
}

/**
 * How long any single provider call may take.
 *
 * Model calls are legitimately slow, so this is generous by HTTP standards and
 * still finite: a provider that has not answered by now is one this request
 * cannot use, and on the unauthenticated live-analysis path an unbounded wait
 * is a request slot held open by whoever asked for it.
 */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;

/**
 * How much of a provider response is worth reading.
 *
 * A structured proposal is kilobytes. Everything past this cap is either a
 * misbehaving endpoint or an attempt to make us buffer memory before local
 * validation gets to reject the body, so it is refused during the read rather
 * than after it.
 */
export const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

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
  /**
   * This provider's own deadline, when the shared default does not fit it.
   *
   * A local model generating on someone's laptop is slow for reasons that have
   * nothing to do with a stalled connection, so the provider that knows this
   * says so rather than making every caller pass a flag.
   */
  readonly defaultTimeoutMs?: number;
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

/**
 * Read a response body under a byte cap, refusing during the read.
 *
 * The cap is enforced while streaming rather than after buffering, so an
 * endpoint that answers with an endless body is dropped instead of being
 * measured. A body-less response (or a transport that does not expose one)
 * falls back to buffering, which is still bounded by the same cap.
 */
async function readBoundedText(
  provider: ModelProvider,
  response: Response,
  maxBytes: number,
): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (text.length > maxBytes) throw callFailed(provider, "the response was too large");
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let read = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > maxBytes) throw callFailed(provider, "the response was too large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

/** POST JSON and return the decoded body, mapping every failure to a safe error. */
export async function postJson(
  provider: ModelProvider,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  call: ProviderCall,
): Promise<unknown> {
  const maxBytes = call.maxResponseBytes ?? MAX_PROVIDER_RESPONSE_BYTES;
  const timeoutMs =
    call.timeoutMs ?? provider.defaultTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  // Rendered from the deadline actually in force, so the message names the
  // number someone can change rather than a constant they cannot find.
  const deadline = timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`;
  // The caller's signal and our deadline are composed rather than chosen
  // between: cancellation must stay observable as cancellation, and a caller
  // that supplies no signal must still not be able to wait forever.
  const controller = new AbortController();
  const abortForCaller = () => controller.abort();
  call.signal?.addEventListener("abort", abortForCaller, { once: true });
  if (call.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await call.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw callFailed(provider, `no answer within ${deadline}`, error);
      }
      if (call.signal?.aborted) throw callFailed(provider, "the request was cancelled", error);
      throw callFailed(provider, "the request could not be sent", error);
    }

    if (!response.ok) {
      // Only the status crosses the boundary — provider error bodies can echo
      // the request, and the request contains untrusted incident content.
      throw callFailed(provider, `upstream status ${response.status}`);
    }

    let text: string;
    try {
      text = await readBoundedText(provider, response, maxBytes);
    } catch (error) {
      if (isDomainError(error)) throw error;
      if (timedOut) {
        throw callFailed(provider, `no answer within ${deadline}`, error);
      }
      if (call.signal?.aborted) throw callFailed(provider, "the request was cancelled", error);
      throw callFailed(provider, "the response could not be read", error);
    }

    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw callFailed(provider, "the response was not valid JSON", error);
    }
  } finally {
    clearTimeout(timer);
    call.signal?.removeEventListener("abort", abortForCaller);
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
