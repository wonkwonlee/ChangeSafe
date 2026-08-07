import { describe, expect, it } from "vitest";

import { createReceipt } from "../src/create-receipt";
import {
  SignedReceiptSchema,
  computePublicKeyId,
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
  signReceipt,
  verifyReceiptSignature,
} from "../src/signature";
import type { ChangeReceipt } from "../src/receipt";

const SIGNED_AT = "2026-07-25T12:00:00.000Z";

async function buildReceipt(overrides: Partial<Parameters<typeof createReceipt>[0]> = {}) {
  return createReceipt({
    sourceId: "src-test",
    inputId: "inc-test-001",
    input: { devices: { "rtr-1": { enabled: true } } },
    proposal: {
      proposalId: "prop-test-001",
      summary: "Shift egress to the healthy uplink",
      diagnosis: {
        likelyCause: "primary uplink degraded",
        confidence: 0.8,
        evidenceIds: ["ev-alert-001"],
        assumptions: [],
      },
      operations: [
        {
          op: "replace",
          path: "/devices/rtr-1/routing/preferences/uplink",
          value: "backup",
          reason: "avoid the degraded path",
          evidenceIds: ["ev-alert-001"],
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
        title: "All operations are valid declarative patches",
        explanation: "every path is allowlisted",
        affectedResources: [],
        remediation: null,
      },
    ],
    policyCoverage: { orderedPolicyIds: ["PATCH_SCHEMA"], skippedPolicies: [] },
    riskLevel: "LOW",
    decision: "gate_only",
    simulation: null,
    createdAtUtc: "2026-07-25T11:00:00.000Z",
    receiptId: "rcpt-test-0001",
    ...overrides,
  });
}

async function loadKeys() {
  const pem = await generateSigningKeyPair();
  const keyPair = await importSigningKeyPair(pem.privateKeyPem);
  const verifying = await importVerifyingKey(pem.publicKeyPem);
  return { pem, keyPair, verifying };
}

describe("receipt signing", () => {
  it("produces a signature a holder of the public key can verify", async () => {
    const receipt = await buildReceipt();
    const { keyPair, verifying } = await loadKeys();

    const signed = await signReceipt(receipt, keyPair, { signedAtUtc: SIGNED_AT });

    expect(signed.signature.algorithm).toBe("ed25519");
    expect(signed.signature.signedAtUtc).toBe(SIGNED_AT);
    expect(await verifyReceiptSignature(signed, verifying)).toBe("valid");
  });

  it("keeps the receipt itself byte-identical — signing is additive", async () => {
    const receipt = await buildReceipt();
    const { keyPair } = await loadKeys();
    const signed = await signReceipt(receipt, keyPair, { signedAtUtc: SIGNED_AT });
    // An unsigned receipt stays valid and unchanged inside the envelope, so
    // existing consumers and `receiptSha256` semantics are untouched.
    expect(signed.receipt).toEqual(receipt);
  });

  it("rejects a receipt altered after signing", async () => {
    const receipt = await buildReceipt();
    const { keyPair, verifying } = await loadKeys();
    const signed = await signReceipt(receipt, keyPair, { signedAtUtc: SIGNED_AT });

    const tampered = {
      ...signed,
      receipt: { ...signed.receipt, decision: "approved" } as ChangeReceipt,
    };
    expect(await verifyReceiptSignature(tampered, verifying)).toBe("invalid");
  });

  it("rejects a signature made by a different key", async () => {
    const receipt = await buildReceipt();
    const mine = await loadKeys();
    const theirs = await loadKeys();

    const signed = await signReceipt(receipt, theirs.keyPair, { signedAtUtc: SIGNED_AT });
    // Someone else's perfectly valid signature is not evidence for my key.
    expect(await verifyReceiptSignature(signed, mine.verifying)).toBe("key_mismatch");
  });

  it("detects a swapped signature body even when the key id still matches", async () => {
    const { keyPair, verifying } = await loadKeys();
    const a = await signReceipt(await buildReceipt(), keyPair, { signedAtUtc: SIGNED_AT });
    const b = await signReceipt(
      await buildReceipt({ receiptId: "rcpt-test-0002" }),
      keyPair,
      { signedAtUtc: SIGNED_AT },
    );

    const spliced = { ...a, signature: { ...a.signature, signature: b.signature.signature } };
    expect(await verifyReceiptSignature(spliced, verifying)).toBe("invalid");
  });

  it("carries no public key, so a receipt can never vouch for itself", async () => {
    const receipt = await buildReceipt();
    const { keyPair } = await loadKeys();
    const signed = await signReceipt(receipt, keyPair, { signedAtUtc: SIGNED_AT });

    // Only a fingerprint travels with the receipt. Verification needs a key
    // obtained out of band, which is what makes it mean anything.
    expect(Object.keys(signed.signature).sort()).toEqual([
      "algorithm",
      "publicKeyId",
      "signature",
      "signedAtUtc",
    ]);
    expect(JSON.stringify(signed)).not.toContain("BEGIN PUBLIC KEY");
  });

  it("names the signing key by a stable fingerprint", async () => {
    const { pem, keyPair, verifying } = await loadKeys();
    const signed = await signReceipt(await buildReceipt(), keyPair, { signedAtUtc: SIGNED_AT });

    expect(signed.signature.publicKeyId).toBe(pem.publicKeyId);
    expect(signed.signature.publicKeyId).toBe(await computePublicKeyId(verifying));
    expect(signed.signature.publicKeyId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("round-trips key material through PEM", async () => {
    const pem = await generateSigningKeyPair();
    expect(pem.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(pem.publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");

    // The public key recovered from the private PEM must be the same key as
    // the exported public PEM, or signing and verifying would disagree.
    const derived = await importSigningKeyPair(pem.privateKeyPem);
    expect(await computePublicKeyId(derived.publicKey)).toBe(pem.publicKeyId);

    const signed = await signReceipt(await buildReceipt(), derived, { signedAtUtc: SIGNED_AT });
    expect(await verifyReceiptSignature(signed, await importVerifyingKey(pem.publicKeyPem))).toBe(
      "valid",
    );
  });

  it("refuses key material that is not a PEM block", async () => {
    await expect(importVerifyingKey("not a pem")).rejects.toMatchObject({
      code: "SCHEMA_VALIDATION",
    });
    await expect(importSigningKeyPair("-----BEGIN PUBLIC KEY-----\nAA==\n-----END PUBLIC KEY-----"))
      .rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
  });

  it("validates the envelope shape", async () => {
    const { keyPair } = await loadKeys();
    const signed = await signReceipt(await buildReceipt(), keyPair, { signedAtUtc: SIGNED_AT });
    expect(SignedReceiptSchema.safeParse(signed).success).toBe(true);

    for (const broken of [
      { ...signed, signature: { ...signed.signature, algorithm: "rsa" } },
      { ...signed, signature: { ...signed.signature, publicKeyId: "not-hex" } },
      { ...signed, signature: { ...signed.signature, signature: "short" } },
    ]) {
      expect(SignedReceiptSchema.safeParse(broken).success).toBe(false);
    }
  });
});
