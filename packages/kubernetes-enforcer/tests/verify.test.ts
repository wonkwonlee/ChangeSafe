import { describe, expect, it } from "vitest";
import {
  AuthorizationGrantSchema,
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
  signGrant,
} from "@changesafe/core";
import {
  verifyGrantAgainstAdmission,
  kubernetesObjectSha256,
  GRANT_ANNOTATION,
} from "../src/verify";
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

// The production hash function itself, not a re-implementation of it: a
// hand-rolled copy here is what let CS-ADV-003 through.
const objectHashOf = kubernetesObjectSha256;

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

  it("denies when a field the policy projection discards is changed post-authorization (CS-ADV-005)", async () => {
    // command/args/env/resources are read by no current policy, so
    // normalizeRawResource's policy projection drops them — reusing that
    // projection for the object hash let this exact tampering through
    // undetected (CS-ADV-005). kubernetesObjectSha256 must not.
    const workload = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: "default" },
      spec: {
        replicas: 3,
        template: {
          spec: {
            containers: [
              {
                name: "app",
                image: "example.com/app:1.0",
                command: ["serve", "--safe-mode"],
                env: [{ name: "FEATURE_FLAG", value: "off" }],
                resources: { limits: { memory: "256Mi" } },
              },
            ],
          },
        },
      },
    };
    const workloadTampered = {
      ...workload,
      spec: {
        ...workload.spec,
        template: {
          spec: {
            containers: [
              {
                ...workload.spec.template.spec.containers[0],
                command: ["serve", "--unsafe-mode"],
              },
            ],
          },
        },
      },
    };

    // The two objects really do differ only in a projection-discarded field.
    expect(await objectHashOf(workload)).not.toBe(await objectHashOf(workloadTampered));

    const { signed, verifying } = await buildSignedGrant({
      objectSha256: await objectHashOf(workload),
    });
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ object: workloadTampered }),
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

  it("denies when the same username belongs to a different uid (CS-ADV-008: recreated ServiceAccount)", async () => {
    // Deleting and recreating a ServiceAccount preserves its username but
    // Kubernetes assigns the new object a new uid. A name-based
    // RoleBinding can restore the same access to the replacement — this
    // proves that alone can't reuse a grant issued for the deleted one.
    const { signed, verifying } = await buildSignedGrant({
      authorizedActorUid: "11111111-1111-1111-1111-111111111111",
    });
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ userInfo: { username: ACTOR, uid: "22222222-2222-2222-2222-222222222222", groups: [] } }),
      verifying,
      NOW,
    );
    expect(outcome.allowed).toBe(false);
  });

  it("allows when the grant carries no uid, matching by username alone (backward compatible)", async () => {
    const { signed, verifying } = await buildSignedGrant(); // no authorizedActorUid
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ userInfo: { username: ACTOR, uid: "any-uid-at-all", groups: [] } }),
      verifying,
      NOW,
      { expectedResource: "res-web-default" },
    );
    expect(outcome).toEqual({ allowed: true });
  });

  it("allows when both sides' uids match", async () => {
    const { signed, verifying } = await buildSignedGrant({
      authorizedActorUid: "11111111-1111-1111-1111-111111111111",
    });
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ userInfo: { username: ACTOR, uid: "11111111-1111-1111-1111-111111111111", groups: [] } }),
      verifying,
      NOW,
      { expectedResource: "res-web-default" },
    );
    expect(outcome).toEqual({ allowed: true });
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

  // The grant is issued against the object's hash *before* the grant is
  // attached to it (kubernetesObjectSha256 excludes GRANT_ANNOTATION for
  // exactly this reason). These two tests exercise that exclusion through
  // the real production hashing path inside verifyGrantAgainstAdmission:
  // the fixture below is hashed without the annotation and admitted with
  // it, so a removed or widened exclusion changes one side and not the
  // other, and the assertion flips.

  it("allows once the grant annotation itself is attached to the admitted object", async () => {
    // objectSha256 is computed on RESOURCE, which carries no annotations at
    // all, so this hash is identical whether or not the exclusion exists.
    const { signed, verifying } = await buildSignedGrant();
    const resourceWithGrantAnnotationAttached = {
      ...RESOURCE,
      metadata: {
        ...RESOURCE.metadata,
        annotations: { [GRANT_ANNOTATION]: "grant-jws-placeholder" },
      },
    };
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ object: resourceWithGrantAnnotationAttached }),
      verifying,
      NOW,
      { expectedResource: "res-web-default" },
    );
    // If production's objectHashOf did NOT exclude GRANT_ANNOTATION, attaching
    // it here would change the computed hash and this would incorrectly deny.
    expect(outcome).toEqual({ allowed: true });
  });

  it("denies when a different annotation is tampered with after authorization", async () => {
    const resourceWithOtherAnnotation = {
      ...RESOURCE,
      metadata: { ...RESOURCE.metadata, annotations: { "team.example.com/owner": "platform-team" } },
    };
    const { signed, verifying } = await buildSignedGrant({
      objectSha256: await objectHashOf(resourceWithOtherAnnotation),
    });
    const tampered = {
      ...resourceWithOtherAnnotation,
      metadata: {
        ...resourceWithOtherAnnotation.metadata,
        annotations: { "team.example.com/owner": "attacker-team" },
      },
    };
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ object: tampered }),
      verifying,
      NOW,
      { expectedResource: "res-web-default" },
    );
    // The exclusion is scoped to exactly GRANT_ANNOTATION; a non-grant
    // annotation must still participate in the object hash, so tampering
    // with it post-authorization must still be caught.
    expect(outcome.allowed).toBe(false);
  });
});
