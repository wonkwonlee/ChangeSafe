import { describe, expect, it, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import {
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
  signGrant,
  AuthorizationGrantSchema,
  canonicalize,
  sha256Hex,
} from "@changesafe/core";
import { normalizeRawResource } from "@changesafe/domain-kubernetes";
import { createEnforcerServer } from "../src/server";

const RESOURCE = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "default" },
  spec: { replicas: 3 },
};

function objectHashOf(raw: unknown): Promise<string> {
  const normalized = normalizeRawResource(raw, "ev-test");
  return sha256Hex(
    canonicalize({ identity: normalized.identity, metadata: normalized.metadata, spec: normalized.spec }),
  );
}

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
      resource: "res-web-default",
      objectSha256: await objectHashOf(RESOURCE),
      policyVersion: "kubernetes-v0.2.0",
      issuedAtUtc: "2026-08-19T12:00:00.000Z",
      expiresAtUtc: "2026-08-19T13:00:00.000Z",
    });
    const signed = await signGrant(grant, keyPair, { signedAtUtc: "2026-08-19T12:00:00.000Z" });

    server = createEnforcerServer({
      trustedPublicKey: verifying,
      now: () => new Date("2026-08-19T12:30:00.000Z"),
      resolveExpectedResource: () => "res-web-default",
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
      resolveExpectedResource: () => "res-web-default",
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
});
