import { createReceipt, type ChangeReceipt } from "@changesafe/core";

/**
 * A throwaway identity provider.
 *
 * Mints real ES256 tokens against a locally generated key and serves a real
 * JWKS document, so the verifier is exercised end to end — signature, claims,
 * key lookup — with no network and no credential. A mocked verifier would
 * only prove the mock works.
 */
export class FakeIdp {
  readonly issuer: string;
  readonly #keyPair: CryptoKeyPair;
  readonly #kid: string;

  private constructor(issuer: string, keyPair: CryptoKeyPair, kid: string) {
    this.issuer = issuer;
    this.#keyPair = keyPair;
    this.#kid = kid;
  }

  static async create(issuer = "https://idp.test"): Promise<FakeIdp> {
    const keyPair = (await globalThis.crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    return new FakeIdp(issuer, keyPair, "test-key-1");
  }

  async jwks(): Promise<{ keys: unknown[] }> {
    const jwk = await globalThis.crypto.subtle.exportKey("jwk", this.#keyPair.publicKey);
    delete jwk.key_ops;
    delete jwk.ext;
    return { keys: [{ ...jwk, kid: this.#kid, use: "sig", alg: "ES256" }] };
  }

  /** Mint a signed token. Overrides let tests build deliberately bad ones. */
  async token(
    claims: Record<string, unknown> = {},
    options: { alg?: string; kid?: string | null } = {},
  ): Promise<string> {
    const header = {
      alg: options.alg ?? "ES256",
      typ: "JWT",
      ...(options.kid === null ? {} : { kid: options.kid ?? this.#kid }),
    };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.issuer,
      sub: "user-alice",
      aud: "changesafe",
      iat: nowSeconds,
      exp: nowSeconds + 600,
      email: "alice@example.test",
      ...claims,
    };

    const encode = (value: unknown) => base64Url(JSON.stringify(value));
    const signingInput = `${encode(header)}.${encode(payload)}`;
    const signature = await globalThis.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.#keyPair.privateKey,
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
  }

  /** A fetch that serves this provider's discovery and key documents. */
  fetch(): typeof globalThis.fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({ issuer: this.issuer, jwks_uri: `${this.issuer}/jwks` });
      }
      if (url === `${this.issuer}/jwks`) {
        return Response.json(await this.jwks());
      }
      return new Response("not found", { status: 404 });
    }) as typeof globalThis.fetch;
  }
}

function base64Url(text: string): string {
  return base64UrlBytes(new TextEncoder().encode(text));
}

function base64UrlBytes(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let counter = 0;

/** A receipt fixture, used where the decision path is not under test. */
export async function someReceipt(
  overrides: Partial<Parameters<typeof createReceipt>[0]> = {},
): Promise<ChangeReceipt> {
  counter += 1;
  return createReceipt({
    sourceId: "src-test",
    inputId: `inc-test-${counter}`,
    input: { a: 1 },
    proposal: {
      proposalId: `prop-test-${counter}`,
      summary: "x",
      diagnosis: {
        likelyCause: "x",
        confidence: 0.5,
        evidenceIds: ["ev-a"],
        assumptions: [],
      },
      operations: [
        {
          op: "replace",
          path: "/a/b",
          value: 1,
          reason: "x",
          evidenceIds: ["ev-a"],
        },
      ],
      rollbackOperations: [],
      verificationSteps: [],
    },
    appVersion: "test-1.0.0",
    policyVersion: "policies-v0.1.0",
    mode: "offline",
    model: null,
    fixtureProvenance: null,
    findings: [
      {
        policyId: "PATCH_SCHEMA",
        status: "PASS",
        title: "ok",
        explanation: "ok",
        affectedResources: [],
        remediation: null,
      },
    ],
    riskLevel: "LOW",
    decision: "gate_only",
    simulation: null,
    createdAtUtc: "2026-07-25T11:00:00.000Z",
    receiptId: `rcpt-test-${String(counter).padStart(4, "0")}`,
    ...overrides,
  });
}
