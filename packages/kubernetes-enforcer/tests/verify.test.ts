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
// The reviewed starting state, for tests that don't specifically exercise
// CS-ADV-014's own before/after distinction — oldObjectSha256 is now
// required on every UPDATE grant, so a default fixture needs one.
const RESOURCE_UID = "11111111-2222-3333-4444-555555555555";
const RESOURCE_PRIOR = {
  ...RESOURCE,
  metadata: { ...RESOURCE.metadata, uid: RESOURCE_UID },
  spec: { replicas: 1 },
};
const ACTOR = "system:serviceaccount:ops:changesafe-applier";
// resourceIdOf({apiVersion:"apps/v1",kind:"Deployment",namespace:"default",name:"web"}) —
// verifyGrantAgainstAdmission now derives this from the admitted object
// itself (CS-ADV-011), so a grant's `resource` field must equal it for
// real, not an arbitrary test double string.
const RESOURCE_ID = "res-1823f5f395a75605";

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
    resource: RESOURCE_ID,
    objectSha256: await objectHashOf(RESOURCE),
    oldObjectSha256: await objectHashOf(RESOURCE_PRIOR),
    resourceUid: RESOURCE_UID,
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
    oldObject: RESOURCE_PRIOR,
    ...overrides,
  } as AdmissionRequest;
}

const NOW = () => new Date("2026-08-19T12:30:00.000Z");

describe("verifyGrantAgainstAdmission", () => {
  it("allows a matching grant and request", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW);
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
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW);
    expect(outcome.allowed).toBe(false);
  });

  it("allows a matching CREATE grant and request (CS-ADV-012: webhook rules now register CREATE too)", async () => {
    // Confirms CREATE is genuinely supported end to end, not just accepted
    // by GrantOperationSchema — the webhook YAML gap (operations: ["UPDATE"]
    // only) was purely a routing omission, not a missing code path.
    // CREATE has no prior state to bind (CS-ADV-014 follow-up): the
    // schema now rejects oldObjectSha256 on a CREATE grant, so the
    // UPDATE-shaped default from buildSignedGrant must be cleared here.
    const { signed, verifying } = await buildSignedGrant({
      operation: "CREATE",
      oldObjectSha256: undefined,
      resourceUid: undefined,
    });
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ operation: "CREATE" }),
      verifying,
      NOW,
    );
    expect(outcome).toEqual({ allowed: true });
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

  it("denies a uid-bound grant when the request's uid is missing (CS-ADV-008 follow-up)", async () => {
    // Whether the uid check applies is the ISSUER's choice, not the
    // request's: an authenticator that never populates userInfo.uid must
    // not be able to silently downgrade a grant that specifically opted
    // into uid-binding back to username-only matching.
    const { signed, verifying } = await buildSignedGrant({
      authorizedActorUid: "11111111-1111-1111-1111-111111111111",
    });
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ userInfo: { username: ACTOR, groups: [] } }), // no uid
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
    );
    // The exclusion is scoped to exactly GRANT_ANNOTATION; a non-grant
    // annotation must still participate in the object hash, so tampering
    // with it post-authorization must still be caught.
    expect(outcome.allowed).toBe(false);
  });

  it("denies replaying an UPDATE grant against a diverged prior state (CS-ADV-014)", async () => {
    // A grant approving v1 -> v2 binds only the target state (v2) unless
    // oldObjectSha256 is set. Without it, the same grant could authorize
    // v3 -> v2 (an unreviewed revert) just as easily as the reviewed
    // v1 -> v2 — this proves oldObjectSha256, once supplied, closes that.
    // Prior states carry the live object's uid, as they always do on a real
    // UPDATE — the grant binds it (CS-ADV-016), and this test is about the
    // state divergence, not the incarnation.
    const v1 = { ...RESOURCE_PRIOR, spec: { replicas: 1 } };
    const v2 = { ...RESOURCE, spec: { replicas: 2 } };
    const v3 = { ...RESOURCE_PRIOR, spec: { replicas: 3 } };
    const { signed, verifying } = await buildSignedGrant({
      objectSha256: await objectHashOf(v2),
      oldObjectSha256: await objectHashOf(v1),
    });

    const reviewed = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ object: v2, oldObject: v1 }),
      verifying,
      NOW,
    );
    expect(reviewed).toEqual({ allowed: true });

    // Same grant, but the object actually diverged to v3 first — a replay
    // attempting to force it back to v2 from a state nobody reviewed.
    const replayed = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ object: v2, oldObject: v3 }),
      verifying,
      NOW,
    );
    expect(replayed.allowed).toBe(false);
  });

  it("denies replaying an UPDATE grant against a recreated incarnation of the same resource (CS-ADV-016)", async () => {
    // State hashes exclude server-assigned identity on purpose, so a
    // Deployment deleted and recreated under the same name, with the same
    // spec, hashes identically to the original — objectSha256 AND
    // oldObjectSha256 both still match. Only the uid tells the two
    // incarnations apart, so the grant has to bind it.
    const original = RESOURCE_PRIOR;
    const recreated = {
      ...RESOURCE_PRIOR,
      metadata: { ...RESOURCE_PRIOR.metadata, uid: "99999999-8888-7777-6666-555555555555" },
    };
    expect(await objectHashOf(original)).toBe(await objectHashOf(recreated));

    const { signed, verifying } = await buildSignedGrant({ resourceUid: RESOURCE_UID });

    const reviewed = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ oldObject: original }),
      verifying,
      NOW,
    );
    expect(reviewed).toEqual({ allowed: true });

    const replayed = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ oldObject: recreated }),
      verifying,
      NOW,
    );
    expect(replayed.allowed).toBe(false);

    // A prior object with no readable uid at all is refused, not waved
    // through: the binding is only as strong as its weakest-shaped input.
    const uidless = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ oldObject: { ...RESOURCE_PRIOR, metadata: RESOURCE.metadata } }),
      verifying,
      NOW,
    );
    expect(uidless.allowed).toBe(false);
  });

  // An UPDATE grant with no oldObjectSha256 can no longer even be
  // constructed — AuthorizationGrantSchema itself now requires it for
  // UPDATE (CS-ADV-014 follow-up); see packages/core/tests/grant.test.ts,
  // "rejects an UPDATE grant with no oldObjectSha256," for that boundary.
  // A CREATE grant has no prior state to bind and stays exempt:

  it("allows a CREATE grant with no oldObjectSha256, since CREATE has no prior state", async () => {
    const { signed, verifying } = await buildSignedGrant({
      operation: "CREATE",
      oldObjectSha256: undefined,
      resourceUid: undefined,
    });
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ operation: "CREATE", oldObject: undefined }),
      verifying,
      NOW,
    );
    expect(outcome).toEqual({ allowed: true });
  });
});
