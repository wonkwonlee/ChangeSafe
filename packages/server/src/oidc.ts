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

const JwtClaimsSchema = z.object({
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

function unauthorized(detail: string): AuthenticationError {
  return new AuthenticationError(detail);
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as unknown;
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
    let response: Response;
    try {
      response = await this.#fetch(jwksUri);
    } catch (error) {
      throw new DomainError(
        "AI_CALL_FAILED",
        "The identity provider's keys could not be fetched.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new DomainError(
        "AI_CALL_FAILED",
        `The identity provider's key endpoint returned status ${response.status}.`,
      );
    }

    const keys = JwksSchema.parse(await response.json()).keys;
    this.#cache = { keys, fetchedAtMs: this.#now() };
    return keys;
  }

  async #discoverJwksUri(): Promise<string> {
    const url = `${this.#config.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    const response = await this.#fetch(url);
    if (!response.ok) {
      throw new DomainError(
        "AI_CALL_FAILED",
        `OIDC discovery returned status ${response.status} for the configured issuer.`,
      );
    }
    const discovery = DiscoverySchema.parse(await response.json());
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

    const header = JwtHeaderSchema.parse(base64UrlToJson(encodedHeader));
    const alg = assertAllowedAlgorithm(header.alg);

    const signature = base64UrlToBytes(encodedSignature);
    const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

    const verified = await this.#verifySignature(header.kid, alg, signature, signed);
    if (!verified) throw unauthorized("the token signature is not valid for this issuer");

    const claims = JwtClaimsSchema.parse(base64UrlToJson(encodedPayload));
    this.#assertClaims(claims);

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
      const keys = await this.#jwks(refresh);
      const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
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
}

/** Pull a bearer token out of an Authorization header. */
export function bearerToken(authorization: string | undefined | null): string {
  const match = /^Bearer (.+)$/.exec(authorization?.trim() ?? "");
  if (!match?.[1]) throw unauthorized("no bearer token was supplied");
  return match[1];
}
