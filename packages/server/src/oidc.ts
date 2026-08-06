import { z } from "zod";

import { DomainError } from "@changesafe/core";

/**
 * OIDC bearer-token verification.
 *
 * Self-hosters put ChangeSafe behind whatever identity provider they already
 * run. This verifies an ID/access token against that provider's published
 * keys — the standard shape for a service behind a reverse proxy — rather
 * than implementing a login flow ChangeSafe would then own the session
 * security for.
 *
 * No dependency: JWS verification is RSASSA-PKCS1-v1_5 or ECDSA through Web
 * Crypto, which both Node and browsers already provide.
 */

/** Asymmetric algorithms only. See `assertAllowedAlgorithm` for why. */
const ALGORITHMS = {
  RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  RS384: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
  RS512: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
  ES256: { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" },
  ES384: { name: "ECDSA", namedCurve: "P-384", hash: "SHA-384" },
} as const;

type AlgorithmName = keyof typeof ALGORITHMS;

const JwtHeaderSchema = z.object({
  alg: z.string(),
  kid: z.string().optional(),
  typ: z.string().optional(),
});

// Loose: a deployment may authorize on a claim this schema does not name
// (group, role, department), so unrecognized claims are kept rather than
// stripped. They are still only ever compared, never interpreted.
const JwtClaimsSchema = z.looseObject({
  iss: z.string(),
  sub: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  nbf: z.number().optional(),
  iat: z.number().optional(),
  email: z.string().optional(),
});

const JwkSchema = z.object({
  kid: z.string().optional(),
  kty: z.string(),
  alg: z.string().optional(),
  use: z.string().optional(),
  n: z.string().optional(),
  e: z.string().optional(),
  crv: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
});

const JwksSchema = z.object({ keys: z.array(JwkSchema) });
const DiscoverySchema = z.object({ jwks_uri: z.string().url(), issuer: z.string() });

export type Jwk = z.infer<typeof JwkSchema>;

/**
 * Who, among the people the provider will vouch for, may use this server.
 *
 * Authentication answers "which person is this"; it does not answer "should
 * this person be approving infrastructure changes". At many organizations
 * every employee holds a valid token from the same issuer, so without this an
 * approver list is whatever the identity provider's user directory happens to
 * be. Both forms are matched exactly — this is a list of people, not a
 * pattern language.
 *
 * Leaving it unset keeps the previous behavior, and `serve` says so out loud
 * at startup rather than letting it pass for a decision.
 */
export interface ApproverPolicy {
  /** Allowed `sub` values. Empty or absent means "any subject". */
  subjects?: readonly string[];
  /**
   * Claims the token must carry, e.g. `{ name: "groups", values: ["sre"] }`.
   * A claim holding an array satisfies the rule when any element matches.
   * Every listed claim must be satisfied.
   */
  claims?: readonly { name: string; values: readonly string[] }[];
}

export interface OidcConfig {
  /** Expected `iss`. Compared exactly — a near-match is a different issuer. */
  issuer: string;
  /** Expected audience; the token's `aud` must contain it. */
  audience: string;
  /** Override discovery, e.g. for a provider without a well-known document. */
  jwksUri?: string;
  /** Tolerance for clock skew between this host and the provider. */
  clockToleranceSeconds?: number;
  /** How long to reuse fetched keys before refetching. */
  jwksCacheSeconds?: number;
  /** Which authenticated identities may act here. Absent means all of them. */
  approvers?: ApproverPolicy;
  /** How long to wait on the provider before giving up. */
  jwksTimeoutMs?: number;
}

export interface VerifiedIdentity {
  subject: string;
  issuer: string;
  email: string | null;
  expiresAtUtc: string;
}

/**
 * A request that established no identity.
 *
 * A distinct type so the HTTP layer answers 401 rather than folding
 * authentication failures in with malformed-request errors — the caller's
 * remedy is completely different.
 */
export class AuthenticationError extends DomainError {
  constructor(detail: string) {
    // The detail says what was wrong with the token, never what a valid one
    // would look like, and never echoes token content.
    super("REQUEST_INVALID", `Authentication failed: ${detail}.`);
    this.name = "AuthenticationError";
  }
}

/**
 * A request that established a real identity which is not permitted here.
 *
 * Separate from `AuthenticationError` because the answers differ: a 401 means
 * "prove who you are", a 403 means "you did, and it is not enough". Retrying
 * with a fresh token fixes the first and never the second.
 */
export class AuthorizationError extends DomainError {
  constructor(detail: string) {
    super("REQUEST_INVALID", `Not permitted: ${detail}.`);
    this.name = "AuthorizationError";
  }
}

function unauthorized(detail: string): AuthenticationError {
  return new AuthenticationError(detail);
}

function forbidden(detail: string): AuthorizationError {
  return new AuthorizationError(detail);
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decode one JWT segment to bytes.
 *
 * `atob` throws on any character outside the alphabet, which is an ordinary
 * property of attacker-supplied input rather than a server fault, so it is
 * normalized here. The signature segment decodes to bytes and never to JSON,
 * and it must fail the same way the JSON segments do.
 */
function decodeSegmentBytes(value: string, segment: string): Uint8Array<ArrayBuffer> {
  try {
    return base64UrlToBytes(value);
  } catch {
    throw unauthorized(`the token's ${segment} is not valid base64url`);
  }
}

/**
 * Decode one JWT segment.
 *
 * Anything a caller can put in an Authorization header can land here —
 * base64 that is not base64, bytes that are not JSON, JSON that is not an
 * object. All of it means the same thing (this request is not authenticated),
 * so it must not escape as a decoding exception that the HTTP layer would
 * report as an internal error.
 */
function base64UrlToJson(value: string, segment: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as unknown;
  } catch {
    throw unauthorized(`the token's ${segment} is not valid base64url JSON`);
  }
}

function parseSegment<T>(schema: z.ZodType<T>, value: unknown, segment: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw unauthorized(`the token's ${segment} is missing required claims`);
  }
  return parsed.data;
}

/**
 * Only asymmetric algorithms are accepted.
 *
 * `none` would make any token valid. HMAC algorithms are worse than useless
 * here: a provider's *public* key is published, so accepting HS256 would let
 * anyone sign a token with that public key as the shared secret — the classic
 * algorithm-confusion attack. Restricting to an allowlist closes both.
 */
function assertAllowedAlgorithm(alg: string): AlgorithmName {
  if (!(alg in ALGORITHMS)) {
    throw unauthorized(`unsupported token algorithm "${alg}"`);
  }
  return alg as AlgorithmName;
}

const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
/** A JWKS is a handful of keys; anything near this is not one. */
const MAX_PROVIDER_DOCUMENT_BYTES = 256 * 1024;

/**
 * Provider documents must come over TLS.
 *
 * These fetches decide who is allowed to approve, so plaintext would let
 * anyone on the path choose the keys this server trusts. Loopback is exempt
 * because there is no network to be on the path of, which keeps local
 * development and test providers workable.
 */
function assertHttps(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DomainError("REQUEST_INVALID", "The identity provider URL is not a valid URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopback) {
    throw new DomainError(
      "REQUEST_INVALID",
      "The identity provider must be reached over https; anyone on the path of a plaintext fetch would choose the keys this server trusts.",
    );
  }
}

/**
 * Keys a token's algorithm could plausibly have been signed with.
 *
 * A JWKS routinely carries keys for other purposes — encryption keys, keys
 * for algorithms this server does not accept. Handing those to `importKey`
 * only produces failed imports, and using an encryption key to check a
 * signature is a category error even when it happens to work.
 */
function keysForAlgorithm(keys: Jwk[], alg: AlgorithmName): Jwk[] {
  const expectedKty = alg.startsWith("RS") ? "RSA" : "EC";
  return keys.filter(
    (key) =>
      key.kty === expectedKty &&
      (key.use === undefined || key.use === "sig") &&
      (key.alg === undefined || key.alg === alg),
  );
}

interface CachedJwks {
  keys: Jwk[];
  fetchedAtMs: number;
}

export class OidcVerifier {
  readonly #config: Required<Pick<OidcConfig, "issuer" | "audience">> & OidcConfig;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  #cache: CachedJwks | null = null;

  constructor(
    config: OidcConfig,
    options: { fetch?: typeof globalThis.fetch; now?: () => number } = {},
  ) {
    this.#config = config;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
  }

  /** Fetch (and cache) the provider's signing keys. */
  async #jwks(forceRefresh = false): Promise<Jwk[]> {
    const ttlMs = (this.#config.jwksCacheSeconds ?? 300) * 1000;
    if (!forceRefresh && this.#cache && this.#now() - this.#cache.fetchedAtMs < ttlMs) {
      return this.#cache.keys;
    }

    const jwksUri = this.#config.jwksUri ?? (await this.#discoverJwksUri());
    const body = await this.#getJson(jwksUri, "The identity provider's key endpoint");

    const keys = JwksSchema.parse(body).keys;
    this.#cache = { keys, fetchedAtMs: this.#now() };
    return keys;
  }

  /**
   * Fetch one provider document under a deadline and a size cap.
   *
   * Both bounds exist because this runs inside request handling: without a
   * deadline an identity provider that accepts connections and then stops
   * talking hangs every authenticated request behind it, and without a cap a
   * key document is whatever the far end decides to send. A provider that
   * cannot answer promptly is a provider that cannot authenticate anyone,
   * which is a refusal, not a wait.
   */
  async #getJson(url: string, what: string): Promise<unknown> {
    assertHttps(url);
    const timeoutMs = this.#config.jwksTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.#fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new DomainError("AI_CALL_FAILED", `${what} returned status ${response.status}.`);
      }
      const text = await response.text();
      if (text.length > MAX_PROVIDER_DOCUMENT_BYTES) {
        throw new DomainError("AI_CALL_FAILED", `${what} returned an implausibly large document.`);
      }
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("AI_CALL_FAILED", `${what} could not be read.`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async #discoverJwksUri(): Promise<string> {
    const url = `${this.#config.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    const discovery = DiscoverySchema.parse(await this.#getJson(url, "OIDC discovery"));
    if (discovery.issuer !== this.#config.issuer) {
      // A discovery document that names a different issuer than the one
      // configured is a misconfiguration or a redirect to somewhere else.
      throw unauthorized("the provider's discovery document names a different issuer");
    }
    return discovery.jwks_uri;
  }

  async #importKey(jwk: Jwk, alg: AlgorithmName): Promise<CryptoKey> {
    const params = ALGORITHMS[alg];
    const algorithm =
      "namedCurve" in params
        ? { name: params.name, namedCurve: params.namedCurve }
        : { name: params.name, hash: params.hash };
    return globalThis.crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
  }

  /**
   * Verify a bearer token and return the identity it establishes.
   *
   * Every failure is the same class of answer — the request is not
   * authenticated — so callers cannot accidentally treat "expired" or "wrong
   * audience" as a softer outcome than "bad signature".
   */
  async verify(token: string): Promise<VerifiedIdentity> {
    const parts = token.split(".");
    if (parts.length !== 3) throw unauthorized("the bearer token is not a JWT");
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

    const header = parseSegment(JwtHeaderSchema, base64UrlToJson(encodedHeader, "header"), "header");
    const alg = assertAllowedAlgorithm(header.alg);

    const signature = decodeSegmentBytes(encodedSignature, "signature");
    const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

    const verified = await this.#verifySignature(header.kid, alg, signature, signed);
    if (!verified) throw unauthorized("the token signature is not valid for this issuer");

    const claims = parseSegment(
      JwtClaimsSchema,
      base64UrlToJson(encodedPayload, "payload"),
      "payload",
    );
    this.#assertClaims(claims);
    // Authorization runs only after the token is proven genuine, so a
    // rejection here is never a hint about whether a signature was valid.
    this.#assertPermitted(claims);

    return {
      subject: claims.sub,
      issuer: claims.iss,
      email: claims.email ?? null,
      expiresAtUtc: new Date(claims.exp * 1000).toISOString(),
    };
  }

  async #verifySignature(
    kid: string | undefined,
    alg: AlgorithmName,
    signature: Uint8Array<ArrayBuffer>,
    signed: Uint8Array,
  ): Promise<boolean> {
    const params = ALGORITHMS[alg];
    const verifyAlgorithm =
      "namedCurve" in params ? { name: params.name, hash: params.hash } : { name: params.name };

    for (const refresh of [false, true]) {
      const usable = keysForAlgorithm(await this.#jwks(refresh), alg);
      const candidates = kid ? usable.filter((key) => key.kid === kid) : usable;
      for (const jwk of candidates) {
        const key = await this.#importKey(jwk, alg);
        const ok = await globalThis.crypto.subtle.verify(
          verifyAlgorithm,
          key,
          signature,
          signed as BufferSource,
        );
        if (ok) return true;
      }
      // A key id we have never seen usually means the provider rotated keys,
      // so refetch once before rejecting rather than failing every request
      // until the cache expires.
      if (candidates.length > 0) break;
    }
    return false;
  }

  #assertClaims(claims: z.infer<typeof JwtClaimsSchema>): void {
    const tolerance = this.#config.clockToleranceSeconds ?? 60;
    const nowSeconds = Math.floor(this.#now() / 1000);

    if (claims.iss !== this.#config.issuer) {
      throw unauthorized("the token was issued by a different issuer");
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.#config.audience)) {
      // A token minted for another service must not be reusable here.
      throw unauthorized("the token was not issued for this audience");
    }
    if (claims.exp + tolerance < nowSeconds) throw unauthorized("the token has expired");
    if (claims.nbf !== undefined && claims.nbf - tolerance > nowSeconds) {
      throw unauthorized("the token is not valid yet");
    }
  }

  /**
   * Apply the deployment's approver policy.
   *
   * The message names the rule that was not met but never the values that
   * would meet it: a caller learns that membership is required, not the
   * membership list.
   */
  #assertPermitted(claims: z.infer<typeof JwtClaimsSchema>): void {
    const policy = this.#config.approvers;
    if (!policy) return;

    if (policy.subjects && policy.subjects.length > 0 && !policy.subjects.includes(claims.sub)) {
      throw forbidden("this subject is not an approver on this server");
    }

    for (const rule of policy.claims ?? []) {
      const value = claims[rule.name];
      const held = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      const satisfied = held.some(
        (candidate) => typeof candidate === "string" && rule.values.includes(candidate),
      );
      if (!satisfied) {
        throw forbidden(`the token does not carry a permitted "${rule.name}" claim`);
      }
    }
  }
}

/** Pull a bearer token out of an Authorization header. */
export function bearerToken(authorization: string | undefined | null): string {
  const match = /^Bearer (.+)$/.exec(authorization?.trim() ?? "");
  if (!match?.[1]) throw unauthorized("no bearer token was supplied");
  return match[1];
}
