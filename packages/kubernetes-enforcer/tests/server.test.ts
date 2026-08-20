import { describe, expect, it, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import {
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
  signGrant,
  AuthorizationGrantSchema,
} from "@changesafe/core";
import { createEnforcerServer } from "../src/server";
import { kubernetesObjectSha256 } from "../src/verify";

const RESOURCE = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "default" },
  spec: { replicas: 3 },
};
// resourceIdOf({apiVersion:"apps/v1",kind:"Deployment",namespace:"default",name:"web"}) —
// verifyGrantAgainstAdmission derives this from the admitted object itself
// (CS-ADV-011), so a grant's `resource` field must equal it for real.
const RESOURCE_ID = "res-1823f5f395a75605";
// A reviewed starting state, distinct from RESOURCE — oldObjectSha256 is
// required on every UPDATE grant (CS-ADV-014 follow-up).
const RESOURCE_PRIOR = { ...RESOURCE, spec: { replicas: 1 } };

// The production hash function itself; see verify.ts's kubernetesObjectSha256.
const objectHashOf = kubernetesObjectSha256;

let server: ReturnType<typeof createEnforcerServer> | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function listen(s: ReturnType<typeof createEnforcerServer>): Promise<string> {
  await new Promise<void>((resolve) => s.listen(0, resolve));
  const { port } = s.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("createEnforcerServer", () => {
  it("allows a request whose grant matches", async () => {
    const pem = await generateSigningKeyPair();
    const keyPair = await importSigningKeyPair(pem.privateKeyPem);
    const verifying = await importVerifyingKey(pem.publicKeyPem);

    const grant = AuthorizationGrantSchema.parse({
      grantId: "grant-test-0001",
      receiptId: "rcpt-test-0001",
      authorizedActor: "system:serviceaccount:ops:changesafe-applier",
      operation: "UPDATE",
      resource: RESOURCE_ID,
      objectSha256: await objectHashOf(RESOURCE),
      oldObjectSha256: await objectHashOf(RESOURCE_PRIOR),
      policyVersion: "kubernetes-v0.2.0",
      issuedAtUtc: "2026-08-19T12:00:00.000Z",
      expiresAtUtc: "2026-08-19T13:00:00.000Z",
    });
    const signed = await signGrant(grant, keyPair, { signedAtUtc: "2026-08-19T12:00:00.000Z" });

    server = createEnforcerServer({
      trustedPublicKey: verifying,
      now: () => new Date("2026-08-19T12:30:00.000Z"),
      // The grant must physically travel with the request; Task 10 decides
      // the real attachment mechanism. For this test, the server reads it
      // from a header the test supplies directly.
      readGrant: (request) => {
        const header = request.headers["x-changesafe-grant"];
        return typeof header === "string" ? JSON.parse(header) : null;
      },
    });
    const base = await listen(server);

    const response = await fetch(`${base}/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-changesafe-grant": JSON.stringify(signed),
      },
      body: JSON.stringify({
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "req-1",
          operation: "UPDATE",
          userInfo: { username: "system:serviceaccount:ops:changesafe-applier", groups: [] },
          object: RESOURCE,
          oldObject: RESOURCE_PRIOR,
        },
      }),
    });

    const body = (await response.json()) as { response: { allowed: boolean } };
    expect(response.status).toBe(200);
    expect(body.response.allowed).toBe(true);
  });

  it("denies when no grant is attached", async () => {
    server = createEnforcerServer({
      trustedPublicKey: (await importVerifyingKey((await generateSigningKeyPair()).publicKeyPem)),
      now: () => new Date("2026-08-19T12:30:00.000Z"),
      readGrant: () => null,
    });
    const base = await listen(server);

    const response = await fetch(`${base}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "req-2",
          operation: "UPDATE",
          userInfo: { username: "system:serviceaccount:ops:changesafe-applier", groups: [] },
          object: RESOURCE,
        },
      }),
    });

    const body = (await response.json()) as { response: { allowed: boolean } };
    expect(response.status).toBe(200);
    expect(body.response.allowed).toBe(false);
  });

  // A malformed grant must never be *weaker* than a missing one. Kubernetes
  // reads any non-2xx reply as "the webhook could not be called" and applies
  // failurePolicy — which is `Ignore` (ADMIT) on the default-tier webhook —
  // so a 500 here would turn garbage in the annotation into an admission.

  async function denyingServer(readGrant: () => unknown | null) {
    return createEnforcerServer({
      trustedPublicKey: await importVerifyingKey((await generateSigningKeyPair()).publicKeyPem),
      now: () => new Date("2026-08-19T12:30:00.000Z"),
      readGrant,
    });
  }

  const reviewBody = (uid: string) =>
    JSON.stringify({
      apiVersion: "admission.k8s.io/v1",
      kind: "AdmissionReview",
      request: {
        uid,
        operation: "UPDATE",
        userInfo: { username: "system:serviceaccount:ops:changesafe-applier", groups: [] },
        object: RESOURCE,
      },
    });

  it("denies (200, not 500) when the attached grant is well-formed JSON but not a SignedGrant", async () => {
    server = await denyingServer(() => ({ totally: "not a grant" }));
    const base = await listen(server);

    const response = await fetch(`${base}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: reviewBody("req-malformed-grant"),
    });

    const body = (await response.json()) as {
      response: { uid: string; allowed: boolean; status?: { message: string } };
    };
    expect(response.status).toBe(200);
    expect(body.response.allowed).toBe(false);
    expect(body.response.uid).toBe("req-malformed-grant");
  });

  it("denies (200, not 500) when the admitted object cannot be normalized", async () => {
    const pem = await generateSigningKeyPair();
    const keyPair = await importSigningKeyPair(pem.privateKeyPem);
    const grant = AuthorizationGrantSchema.parse({
      grantId: "grant-test-0002",
      receiptId: "rcpt-test-0002",
      authorizedActor: "system:serviceaccount:ops:changesafe-applier",
      operation: "UPDATE",
      resource: RESOURCE_ID,
      objectSha256: await objectHashOf(RESOURCE),
      oldObjectSha256: await objectHashOf(RESOURCE_PRIOR),
      policyVersion: "kubernetes-v0.2.0",
      issuedAtUtc: "2026-08-19T12:00:00.000Z",
      expiresAtUtc: "2026-08-19T13:00:00.000Z",
    });
    const signed = await signGrant(grant, keyPair, { signedAtUtc: "2026-08-19T12:00:00.000Z" });

    server = createEnforcerServer({
      trustedPublicKey: await importVerifyingKey(pem.publicKeyPem),
      now: () => new Date("2026-08-19T12:30:00.000Z"),
      readGrant: () => signed,
    });
    const base = await listen(server);

    // A DELETE review's `object` is genuinely `null` in real Kubernetes
    // AdmissionReview payloads — canonicalizeAdmittedResource (inside
    // verifyGrantAgainstAdmission) throws on it, which this must catch and
    // answer as an explicit deny, not let escape to the 500 handler.
    const response = await fetch(`${base}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "req-unnormalizable-object",
          operation: "UPDATE",
          userInfo: { username: "system:serviceaccount:ops:changesafe-applier", groups: [] },
          object: null,
        },
      }),
    });

    const body = (await response.json()) as { response: { allowed: boolean } };
    expect(response.status).toBe(200);
    expect(body.response.allowed).toBe(false);
  });

  it("processes (not denies-by-truncation) an ordinary UPDATE whose old+new objects exceed 1 MiB combined", async () => {
    // Kubernetes carries BOTH object and oldObject on an UPDATE, so a single
    // ordinary Deployment (well under any per-object size a cluster would
    // reject) can combine to exceed a too-tight body cap. This must not be
    // treated the same as a malformed/oversized-malicious body: the request
    // is legitimate, so its real uid must survive and the check must still
    // run — this is exactly the gap the 1 MiB -> 8 MiB cap raise closed.
    const padding = "x".repeat(600 * 1024); // ~600 KiB per object
    const largeResource = { ...RESOURCE, metadata: { ...RESOURCE.metadata, annotations: { padding } } };
    server = await denyingServer(() => null); // no grant attached: exercises the real path, expects a real deny (not a truncation artifact)
    const base = await listen(server);

    const response = await fetch(`${base}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "req-large-update",
          operation: "UPDATE",
          userInfo: { username: "system:serviceaccount:ops:changesafe-applier", groups: [] },
          object: largeResource,
          oldObject: largeResource,
        },
      }),
    });

    const body = (await response.json()) as {
      response: { uid: string; allowed: boolean; status?: { message: string } };
    };
    expect(response.status).toBe(200);
    // The real uid must survive — a lost/empty uid here is exactly what
    // makes Kubernetes treat the response as invalid and fall back to
    // failurePolicy instead of trusting this explicit denial.
    expect(body.response.uid).toBe("req-large-update");
    expect(body.response.allowed).toBe(false);
    expect(body.response.status?.message).toBe("no AuthorizationGrant was attached to this request");
  });

  it("denies (200, not 500) when the AdmissionReview body itself is malformed", async () => {
    server = await denyingServer(() => null);
    const base = await listen(server);

    const response = await fetch(`${base}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiVersion: "admission.k8s.io/v1", kind: "AdmissionReview" }),
    });

    const body = (await response.json()) as { response: { allowed: boolean } };
    expect(response.status).toBe(200);
    expect(body.response.allowed).toBe(false);
  });
});
