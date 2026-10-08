import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { z } from "zod";
import { SignedGrantSchema, hashCanonical, importSigningKeyPair } from "@changesafe/core";
import { Ledger } from "@changesafe/ledger";
import { DecisionService, DurableReviewStore, createDecisionServer, OidcVerifier } from "@changesafe/server";
import { FakeIdp } from "../../packages/server/tests/helpers";

// The cluster driver supplies read-only objects and an ephemeral signing key.
// Default tests never query a cluster or spend model credit.
it.skipIf(!process.env.CHANGESAFE_KIND_WORK_DIR)("authorizes the live kind transition through authenticated durable HTTP", async () => {
  const dir = z.string().min(1).parse(process.env.CHANGESAFE_KIND_WORK_DIR);
  const current = JSON.parse(readFileSync(path.join(dir, "web-current.json"), "utf8")) as unknown;
  const candidate = z.object({ spec: z.record(z.string(), z.unknown()) }).passthrough().parse(structuredClone(current));
  candidate.spec.replicas = 4;
  const content = { snapshot: {
    snapshotVersion: "changesafe-kubernetes-snapshot/v1", snapshotId: "snap-kind-http",
    evidenceId: "ev-snap-kind-http", provenance: { source: "cluster-api", collectedAtUtc: new Date().toISOString(),
      contextFingerprint: "kind-local-reproduction", namespaces: ["changesafe-protected-demo"], serverVersion: null },
    resources: [current],
  }, manifestText: JSON.stringify(candidate) };
  const idp = await FakeIdp.create();
  const ledger = Ledger.open(path.join(dir, "decisions.db"));
  const reviews = DurableReviewStore.open(path.join(dir, "reviews.db"));
  const server = createDecisionServer({ ledger, reviews,
    decisions: new DecisionService({ ledger, appVersion: "changesafe-kind-http", signingKeyPair:
      await importSigningKeyPair(readFileSync(path.join(dir, "grant-private.pem"), "utf8")) }),
    verifier: new OidcVerifier({ issuer: idp.issuer, audience: "changesafe", jwksUri: `${idp.issuer}/jwks` }, { fetch: idp.fetch() }),
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const token = await idp.token();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const intake = await fetch(`${base}/reviews`, { method: "POST", headers, body: JSON.stringify({
      reviewId: "review-kind-http", intake: { domainId: "kubernetes", source: {
        domainId: "kubernetes", sourceId: "kind-http-source", sourceKind: "kubernetes-snapshot",
        origin: "uploaded-offline-artifact", untrustedArtifactObservedAtUtc: new Date().toISOString(),
      }, input: { inputId: "snap-kind-http", inputSha256: await hashCanonical(content), content } },
    }) });
    expect(intake.status, JSON.stringify(await intake.json())).toBe(201);
    const intent = { decision: "approve", grant: { authorizedActor: z.string().min(1).parse(process.env.CHANGESAFE_KIND_ACTOR),
      expiresAtUtc: new Date(Date.now() + 3600000).toISOString() } };
    const decided = await fetch(`${base}/reviews/review-kind-http/decisions`, { method: "POST", headers, body: JSON.stringify(intent) });
    const body = await decided.json();
    expect(decided.status, JSON.stringify(body)).toBe(201);
    const signed = SignedGrantSchema.parse(body.grant);
    writeFileSync(path.join(dir, "step1-grant.json"), JSON.stringify(signed));
    const recovered = await fetch(`${base}/reviews/review-kind-http/decisions`, { method: "POST", headers, body: JSON.stringify(intent) });
    expect(recovered.status).toBe(201);
    expect((await recovered.json()).grant).toEqual(signed);
    expect(ledger.count()).toBe(1);
    expect((await ledger.verifyChain()).ok).toBe(true);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    reviews.close(); ledger.close();
  }
});
