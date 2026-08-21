/**
 * The M2 chain end to end: a grant the *server* really issued, verified by
 * the *enforcer* against a real AdmissionReview request.
 *
 * Every other M2 test covers one half. `packages/server/tests/issue-grant.test.ts`
 * asserts shallow properties of an issued grant and never enforces it;
 * `packages/kubernetes-enforcer/tests/verify.test.ts` builds its grants
 * locally with AuthorizationGrantSchema.parse + signGrant and never goes
 * through DecisionService. Nothing composed the two, so the seam between
 * issuance and verification — which is what this milestone is about — was
 * untested. This test lives in tests/integration because it deliberately
 * spans two packages that do not (and should not) depend on each other.
 */
import { describe, expect, it } from "vitest";
import {
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
} from "@changesafe/core";
import { normalizeRawResource } from "@changesafe/domain-kubernetes";
import { Ledger } from "@changesafe/ledger";
import { DecisionService } from "@changesafe/server";
import {
  kubernetesObjectSha256,
  verifyGrantAgainstAdmission,
} from "@changesafe/kubernetes-enforcer";
import type { AdmissionRequest } from "@changesafe/kubernetes-enforcer";

const ACTOR = "system:serviceaccount:ops:changesafe-applier";
const ISSUED_AT = "2026-08-19T12:00:00.000Z";
const EXPIRES_AT = "2026-08-19T13:00:00.000Z";
const NOW = () => new Date("2026-08-19T12:30:00.000Z");

const SNAPSHOT = {
  snapshotVersion: "changesafe-kubernetes-snapshot/v1",
  snapshotId: "snap-m2-0001",
  evidenceId: "ev-snap-m2-0001",
  provenance: {
    source: "authored",
    collectedAtUtc: "2026-08-19T00:00:00.000Z",
    contextFingerprint: "context-m2-0001",
    namespaces: ["default"],
    serverVersion: null,
  },
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: "default", uid: "11111111-2222-3333-4444-555555555555" },
      spec: { replicas: 2 },
    },
  ],
};

const MANIFEST_TEXT = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 3
`;

/** What the API server would send the webhook once that manifest is applied. */
const ADMITTED_OBJECT = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "default" },
  spec: { replicas: 3 },
};

async function issueRealGrant() {
  const pem = await generateSigningKeyPair();
  const decisions = new DecisionService({
    ledger: Ledger.open(":memory:"),
    appVersion: "test-1.0.0",
    signingKeyPair: await importSigningKeyPair(pem.privateKeyPem),
    now: () => ISSUED_AT,
  });

  const outcome = await decisions.decide(
    {
      domain: "kubernetes",
      sourceId: "m2-grant-chain",
      input: SNAPSHOT,
      proposal: MANIFEST_TEXT,
      decision: "approve",
    },
    { subject: "approver-1", issuer: "https://issuer.example", email: null },
  );
  expect(outcome.receipt.decision).toBe("approved");

  const normalized = normalizeRawResource(ADMITTED_OBJECT, "ev-m2-admission");
  const signed = await decisions.issueGrant(outcome.receipt, {
    authorizedActor: ACTOR,
    operation: "UPDATE",
    resource: normalized.resourceId,
    objectSha256: await kubernetesObjectSha256(ADMITTED_OBJECT),
    // The snapshot's own resource IS the reviewed starting state — the
    // decision approved a change from exactly this to ADMITTED_OBJECT.
    // oldObjectSha256 is now required on every UPDATE grant (CS-ADV-014
    // follow-up).
    oldObjectSha256: await kubernetesObjectSha256(SNAPSHOT.resources[0]),
    resourceUid: "11111111-2222-3333-4444-555555555555",
    expiresAtUtc: EXPIRES_AT,
  });

  return {
    signed,
    verifying: await importVerifyingKey(pem.publicKeyPem),
    resource: normalized.resourceId,
    policyVersion: outcome.receipt.policyVersion,
  };
}

function admissionRequest(object: unknown, oldObject: unknown = SNAPSHOT.resources[0]): AdmissionRequest {
  return {
    uid: "req-m2-1",
    operation: "UPDATE",
    userInfo: { username: ACTOR, groups: [] },
    object,
    oldObject,
  } as AdmissionRequest;
}

describe("M2: a server-issued grant enforced at the admission boundary", () => {
  it("allows the exact object the approved decision authorized", async () => {
    const { signed, verifying, policyVersion } = await issueRealGrant();

    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest(ADMITTED_OBJECT),
      verifying,
      NOW,
      { expectedPolicyVersion: policyVersion },
    );

    expect(outcome).toEqual({ allowed: true });
  });

  it("denies once the admitted object is mutated after authorization", async () => {
    const { signed, verifying, policyVersion } = await issueRealGrant();

    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ ...ADMITTED_OBJECT, spec: { replicas: 99 } }),
      verifying,
      NOW,
      { expectedPolicyVersion: policyVersion },
    );

    expect(outcome).toEqual({
      allowed: false,
      reason: "requested object does not match the object the grant authorized",
    });
  });

  it("carries the receipt's own policy version, so the drift check is real", async () => {
    const { signed, verifying, policyVersion } = await issueRealGrant();
    expect(signed.grant.policyVersion).toBe(policyVersion);

    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest(ADMITTED_OBJECT),
      verifying,
      NOW,
      { expectedPolicyVersion: `${policyVersion}-next` },
    );

    expect(outcome.allowed).toBe(false);
  });
});
