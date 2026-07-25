import { describe, expect, it } from "vitest";

import { OidcVerifier, bearerToken, type OidcConfig } from "../src/oidc";
import { FakeIdp } from "./helpers";

const AUDIENCE = "changesafe";

async function setup(overrides: Partial<OidcConfig> = {}) {
  const idp = await FakeIdp.create();
  const verifier = new OidcVerifier(
    { issuer: idp.issuer, audience: AUDIENCE, ...overrides },
    { fetch: idp.fetch() },
  );
  return { idp, verifier };
}

describe("OIDC bearer verification", () => {
  it("accepts a well-formed token and reports the identity", async () => {
    const { idp, verifier } = await setup();
    const identity = await verifier.verify(await idp.token());

    expect(identity.subject).toBe("user-alice");
    expect(identity.issuer).toBe(idp.issuer);
    expect(identity.email).toBe("alice@example.test");
  });

  it("discovers the key endpoint from the issuer", async () => {
    const { idp, verifier } = await setup();
    // No jwksUri configured, so this only passes via .well-known discovery.
    await expect(verifier.verify(await idp.token())).resolves.toBeTruthy();
  });

  it("rejects a token signed by a different provider", async () => {
    const { verifier } = await setup();
    const attacker = await FakeIdp.create();
    // Same issuer string, different key: only the signature check catches it.
    await expect(verifier.verify(await attacker.token())).rejects.toThrow(/signature is not valid/);
  });

  it("rejects a token minted for another audience", async () => {
    const { idp, verifier } = await setup();
    await expect(verifier.verify(await idp.token({ aud: "some-other-service" }))).rejects.toThrow(
      /not issued for this audience/,
    );
  });

  it("rejects a token from another issuer", async () => {
    const { idp, verifier } = await setup();
    await expect(verifier.verify(await idp.token({ iss: "https://evil.test" }))).rejects.toThrow(
      /different issuer/,
    );
  });

  it("rejects an expired token", async () => {
    const { idp, verifier } = await setup();
    const expired = Math.floor(Date.now() / 1000) - 3600;
    await expect(verifier.verify(await idp.token({ exp: expired }))).rejects.toThrow(/expired/);
  });

  it("allows a token that expired within the clock-skew tolerance", async () => {
    // Deliberate: hosts drift, and rejecting a token that expired two seconds
    // ago would make an otherwise healthy deployment flaky. The window is
    // narrow and configurable, not absent.
    const { idp, verifier } = await setup({ clockToleranceSeconds: 60 });
    const justExpired = Math.floor(Date.now() / 1000) - 5;
    await expect(verifier.verify(await idp.token({ exp: justExpired }))).resolves.toBeTruthy();

    const wellExpired = Math.floor(Date.now() / 1000) - 600;
    await expect(verifier.verify(await idp.token({ exp: wellExpired }))).rejects.toThrow(/expired/);
  });

  it("honours a zero tolerance when a deployment wants one", async () => {
    const { idp, verifier } = await setup({ clockToleranceSeconds: 0 });
    const justExpired = Math.floor(Date.now() / 1000) - 5;
    await expect(verifier.verify(await idp.token({ exp: justExpired }))).rejects.toThrow(/expired/);
  });

  it("rejects a token that is not valid yet", async () => {
    const { idp, verifier } = await setup();
    const future = Math.floor(Date.now() / 1000) + 3600;
    await expect(verifier.verify(await idp.token({ nbf: future }))).rejects.toThrow(
      /not valid yet/,
    );
  });

  it("refuses the alg=none forgery", async () => {
    const { idp, verifier } = await setup();
    // The oldest JWT attack: claim no signature was needed.
    await expect(verifier.verify(await idp.token({}, { alg: "none" }))).rejects.toThrow(
      /unsupported token algorithm/,
    );
  });

  it("refuses HMAC algorithms outright", async () => {
    const { idp, verifier } = await setup();
    // Algorithm confusion: a provider's public key is published, so an
    // HS256-accepting verifier lets anyone sign with it as a shared secret.
    await expect(verifier.verify(await idp.token({}, { alg: "HS256" }))).rejects.toThrow(
      /unsupported token algorithm/,
    );
  });

  it("rejects a token whose payload was edited after signing", async () => {
    const { idp, verifier } = await setup();
    const token = await idp.token();
    const [header, , signature] = token.split(".") as [string, string, string];
    const forgedPayload = btoa(
      JSON.stringify({
        iss: idp.issuer,
        sub: "user-attacker",
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await expect(verifier.verify(`${header}.${forgedPayload}.${signature}`)).rejects.toThrow(
      /signature is not valid/,
    );
  });

  it("rejects malformed tokens", async () => {
    const { verifier } = await setup();
    await expect(verifier.verify("not-a-jwt")).rejects.toThrow(/not a JWT/);
  });

  it("refuses a discovery document that names a different issuer", async () => {
    const idp = await FakeIdp.create();
    const lying: typeof globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/.well-known/openid-configuration")) {
        return Response.json({ issuer: "https://elsewhere.test", jwks_uri: `${idp.issuer}/jwks` });
      }
      return idp.fetch()(input);
    }) as typeof globalThis.fetch;

    const verifier = new OidcVerifier(
      { issuer: idp.issuer, audience: AUDIENCE },
      { fetch: lying },
    );
    await expect(verifier.verify(await idp.token())).rejects.toThrow(/different issuer/);
  });

  it("caches keys, then refetches when an unknown key id appears", async () => {
    const idp = await FakeIdp.create();
    let fetches = 0;
    const counting: typeof globalThis.fetch = (async (input: string | URL | Request) => {
      fetches += 1;
      return idp.fetch()(input);
    }) as typeof globalThis.fetch;

    const verifier = new OidcVerifier(
      { issuer: idp.issuer, audience: AUDIENCE, jwksUri: `${idp.issuer}/jwks` },
      { fetch: counting },
    );

    await verifier.verify(await idp.token());
    const afterFirst = fetches;
    await verifier.verify(await idp.token());
    expect(fetches).toBe(afterFirst); // served from cache

    // An unrecognized kid usually means the provider rotated; refetch once
    // rather than failing every request until the cache expires.
    await expect(verifier.verify(await idp.token({}, { kid: "rotated-key" }))).rejects.toThrow();
    expect(fetches).toBeGreaterThan(afterFirst);
  });
});

describe("bearerToken", () => {
  it("extracts a token from an Authorization header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("rejects anything that is not a bearer credential", () => {
    for (const header of [undefined, null, "", "Basic abc", "abc.def.ghi", "Bearer"]) {
      expect(() => bearerToken(header)).toThrow(/no bearer token/);
    }
  });
});
