import { describe, expect, it } from "vitest";
import {
  AuthorizationGrantSchema,
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
  sha256Hex,
  signGrant,
  canonicalize,
} from "@changesafe/core";
import { normalizeRawResource } from "@changesafe/domain-kubernetes";
import { verifyGrantAgainstAdmission } from "../src/verify";
import type { AdmissionRequest } from "../src/admission-review";

const RESOURCE = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "default" },
  spec: { replicas: 3 },
};
const RESOURCE_MODIFIED = { ...RESOURCE, spec: { replicas: 99 } };
const ACTOR = "system:serviceaccount:ops:changesafe-applier";

async function keys() {
  const pem = await generateSigningKeyPair();
  return {
    keyPair: await importSigningKeyPair(pem.privateKeyPem),
    verifying: await importVerifyingKey(pem.publicKeyPem),
  };
}

function objectHashOf(raw: unknown): Promise<string> {
  const normalized = normalizeRawResource(raw, "ev-test");
  return sha256Hex(
    canonicalize({ identity: normalized.identity, metadata: normalized.metadata, spec: normalized.spec }),
  );
}

async function buildSignedGrant(overrides: Partial<Record<string, unknown>> = {}) {
  const { keyPair, verifying } = await keys();
  const grant = AuthorizationGrantSchema.parse({
    grantId: "grant-test-0001",
    receiptId: "rcpt-test-0001",
    authorizedActor: ACTOR,
    operation: "UPDATE",
    resource: "res-web-default",
    objectSha256: await objectHashOf(RESOURCE),
    policyVersion: "kubernetes-v0.2.0",
    issuedAtUtc: "2026-08-19T12:00:00.000Z",
    expiresAtUtc: "2026-08-19T13:00:00.000Z",
    ...overrides,
  });
  const signed = await signGrant(grant, keyPair, { signedAtUtc: "2026-08-19T12:00:00.000Z" });
  return { signed, verifying };
}

function admissionRequest(overrides: Partial<AdmissionRequest> = {}): AdmissionRequest {
  return {
    uid: "req-1",
    operation: "UPDATE",
    userInfo: { username: ACTOR, groups: [] },
    object: RESOURCE,
    ...overrides,
  } as AdmissionRequest;
}

const NOW = () => new Date("2026-08-19T12:30:00.000Z");

describe("verifyGrantAgainstAdmission", () => {
  it("allows a matching grant and request", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW, {
      expectedResource: "res-web-default",
    });
    expect(outcome).toEqual({ allowed: true });
  });

  it("denies on object substitution (object changed after authorization)", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ object: RESOURCE_MODIFIED }),
      verifying,
      NOW,
    );
    expect(outcome.allowed).toBe(false);
  });

  it("denies on resource substitution", async () => {
    const { signed, verifying } = await buildSignedGrant({ resource: "res-a-different-resource" });
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW, {
      expectedResource: "res-web-default",
    });
    expect(outcome.allowed).toBe(false);
  });

  it("denies on operation substitution", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ operation: "DELETE" }),
      verifying,
      NOW,
    );
    expect(outcome.allowed).toBe(false);
  });

  it("denies on identity substitution", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ userInfo: { username: "system:serviceaccount:ops:attacker", groups: [] } }),
      verifying,
      NOW,
    );
    expect(outcome.allowed).toBe(false);
  });

  it("denies a grant signed by an untrusted key (replay with a forged grant)", async () => {
    const { signed } = await buildSignedGrant();
    const otherKeys = await keys();
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), otherKeys.verifying, NOW);
    expect(outcome.allowed).toBe(false);
  });

  it("denies a stale/expired grant", async () => {
    const { signed, verifying } = await buildSignedGrant({
      expiresAtUtc: "2026-08-19T12:15:00.000Z",
    });
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW);
    expect(outcome.allowed).toBe(false);
  });

  it("denies on policy version drift", async () => {
    const { signed, verifying } = await buildSignedGrant({ policyVersion: "kubernetes-v0.1.0" });
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest(),
      verifying,
      NOW,
      { expectedPolicyVersion: "kubernetes-v0.2.0" },
    );
    expect(outcome.allowed).toBe(false);
  });
});
