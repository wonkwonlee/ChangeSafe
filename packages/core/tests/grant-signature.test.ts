import { describe, expect, it } from "vitest";
import { AuthorizationGrantSchema, type AuthorizationGrant } from "../src/grant";
import {
  SignedGrantSchema,
  signGrant,
  verifyGrantSignature,
} from "../src/grant-signature";
import {
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
} from "../src/signature";

const SIGNED_AT = "2026-08-19T12:30:00.000Z";

function buildGrant(overrides: Partial<AuthorizationGrant> = {}): AuthorizationGrant {
  return AuthorizationGrantSchema.parse({
    grantId: "grant-test-0001",
    receiptId: "rcpt-test-0001",
    authorizedActor: "system:serviceaccount:ops:changesafe-applier",
    operation: "UPDATE",
    resource: "res-0123456789abcdef",
    objectSha256: "a".repeat(64),
    policyVersion: "kubernetes-v0.2.0",
    issuedAtUtc: "2026-08-19T12:00:00.000Z",
    expiresAtUtc: "2026-08-19T13:00:00.000Z",
    ...overrides,
  });
}

async function loadKeys() {
  const pem = await generateSigningKeyPair();
  const keyPair = await importSigningKeyPair(pem.privateKeyPem);
  const verifying = await importVerifyingKey(pem.publicKeyPem);
  return { pem, keyPair, verifying };
}

describe("grant signing", () => {
  it("produces a signature a holder of the public key can verify", async () => {
    const { keyPair, verifying } = await loadKeys();
    const signed = await signGrant(buildGrant(), keyPair, { signedAtUtc: SIGNED_AT });

    expect(signed.signature.algorithm).toBe("ed25519");
    expect(await verifyGrantSignature(signed, verifying)).toBe("valid");
  });

  it("rejects a grant altered after signing", async () => {
    const { keyPair, verifying } = await loadKeys();
    const signed = await signGrant(buildGrant(), keyPair, { signedAtUtc: SIGNED_AT });

    const tampered = {
      ...signed,
      grant: { ...signed.grant, authorizedActor: "system:serviceaccount:ops:attacker" },
    };
    expect(await verifyGrantSignature(tampered, verifying)).toBe("invalid");
  });

  it("rejects a signature made by a different key", async () => {
    const mine = await loadKeys();
    const theirs = await loadKeys();
    const signed = await signGrant(buildGrant(), theirs.keyPair, { signedAtUtc: SIGNED_AT });
    expect(await verifyGrantSignature(signed, mine.verifying)).toBe("key_mismatch");
  });

  it("validates the envelope shape", async () => {
    const { keyPair } = await loadKeys();
    const signed = await signGrant(buildGrant(), keyPair, { signedAtUtc: SIGNED_AT });
    expect(SignedGrantSchema.safeParse(signed).success).toBe(true);
    expect(
      SignedGrantSchema.safeParse({ ...signed, signature: { ...signed.signature, algorithm: "rsa" } })
        .success,
    ).toBe(false);
  });
});
