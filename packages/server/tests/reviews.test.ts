import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SignedReceiptSchema,
  generateSigningKeyPair,
  hashCanonical,
  importSigningKeyPair,
} from "@changesafe/core";
import { normalizePlan } from "@changesafe/domain-terraform";
import { Ledger } from "@changesafe/ledger";

import { TERRAFORM_PUBLIC_REPLAY_FIXTURES } from "../../../features/domains/terraform/fixtures";
import { DecisionService } from "../src/decisions";
import { DurableReviewStore } from "../src/durable-review-store";
import { createDecisionServer } from "../src/http";
import { OidcVerifier } from "../src/oidc";
import { FakeIdp } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(here, "../../../scenarios");

const networkInput = JSON.parse(
  readFileSync(path.join(scenarios, "scenario-a-failover", "incident.json"), "utf8"),
) as unknown;
const networkProposal = (
  JSON.parse(
    readFileSync(path.join(scenarios, "scenario-a-failover", "replay-fixture.json"), "utf8"),
  ) as { proposal: unknown }
).proposal;
const blockedNetworkInput = JSON.parse(
  readFileSync(path.join(scenarios, "scenario-b-route-leak", "incident.json"), "utf8"),
) as unknown;
const blockedNetworkProposal = (
  JSON.parse(
    readFileSync(path.join(scenarios, "scenario-b-route-leak", "replay-fixture.json"), "utf8"),
  ) as { proposal: unknown }
).proposal;

let context: {
  idp: FakeIdp;
  ledger: Ledger;
  reviews: DurableReviewStore;
  baseUrl: string;
  ledgerOpen: boolean;
  close: () => Promise<void>;
};

beforeEach(async () => {
  const idp = await FakeIdp.create();
  const ledger = Ledger.open(":memory:");
  const reviews = DurableReviewStore.open(":memory:");
  const pem = await generateSigningKeyPair();
  let clockTick = 0;
  const server = createDecisionServer({
    ledger,
    reviews,
    verifier: new OidcVerifier(
      { issuer: idp.issuer, audience: "changesafe", jwksUri: `${idp.issuer}/jwks` },
      { fetch: idp.fetch() },
    ),
    decisions: new DecisionService({
      ledger,
      appVersion: "changesafe-server-test",
      signingKeyPair: await importSigningKeyPair(pem.privateKeyPem),
    }),
    now: () => `2026-07-30T05:00:0${clockTick++}.000Z`,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  context = {
    idp,
    ledger,
    reviews,
    baseUrl: `http://127.0.0.1:${port}`,
    ledgerOpen: true,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      reviews.close();
      if (context.ledgerOpen) ledger.close();
    },
  };
});

afterEach(async () => context.close());

async function pendingNetworkReview(reviewId = "review-network-one") {
  return {
    reviewId,
    intake: {
      domainId: "network",
      source: {
        domainId: "network",
        sourceId: "network-source-one",
        sourceKind: "network-incident-bundle",
        origin: "uploaded-offline-artifact",
        untrustedArtifactObservedAtUtc: "2026-07-30T03:00:00.000Z",
      },
      input: {
        inputId: "inc-uplink-degraded-4821",
        inputSha256: await hashCanonical(networkInput),
        content: networkInput,
      },
      proposal: {
        proposalId: (networkProposal as { proposalId: string }).proposalId,
        proposalSha256: await hashCanonical(networkProposal),
        content: networkProposal,
      },
    },
  };
}

async function pendingBlockedNetworkReview(reviewId = "review-network-blocked") {
  return {
    reviewId,
    intake: {
      domainId: "network",
      source: {
        domainId: "network",
        sourceId: "network-source-blocked",
        sourceKind: "network-incident-bundle",
        origin: "uploaded-offline-artifact",
        untrustedArtifactObservedAtUtc: "2026-07-30T03:00:00.000Z",
      },
      input: {
        inputId: "inc-route-leak-4977",
        inputSha256: await hashCanonical(blockedNetworkInput),
        content: blockedNetworkInput,
      },
      proposal: {
        proposalId: (blockedNetworkProposal as { proposalId: string }).proposalId,
        proposalSha256: await hashCanonical(blockedNetworkProposal),
        content: blockedNetworkProposal,
      },
    },
  };
}

async function pendingTerraformReview(reviewId = "review-terraform-one") {
  const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES[0]!;
  const content = normalizePlan(fixture.plan, {
    planId: fixture.inputId,
    context: [...fixture.context],
  });
  return {
    reviewId,
    intake: {
      domainId: "terraform",
      source: {
        domainId: "terraform",
        sourceId: "terraform-source-one",
        sourceKind: "terraform-show-json",
        origin: "read-only-collector",
        untrustedArtifactObservedAtUtc: "2026-07-30T03:00:00.000Z",
      },
      input: {
        inputId: fixture.inputId,
        inputSha256: await hashCanonical(content),
        content,
      },
    },
  };
}

async function postReview(body: unknown, token?: string) {
  return fetch(`${context.baseUrl}/reviews`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function decideReview(reviewId: string, body: unknown, token?: string) {
  return fetch(`${context.baseUrl}/reviews/${reviewId}/decisions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("durable review intake HTTP API", () => {
  it("authenticates before reading an intake body or queue", async () => {
    const response = await postReview({ not: "a valid intake" });

    expect(response.status).toBe(401);
    expect(context.reviews.count()).toBe(0);
    expect(context.ledger.count()).toBe(0);
  });

  it("does not expose the queue to anonymous callers", async () => {
    expect((await fetch(`${context.baseUrl}/reviews`)).status).toBe(401);
    expect((await fetch(`${context.baseUrl}/reviews/review-network-one`)).status).toBe(401);
    expect(context.reviews.count()).toBe(0);
  });

  it("accepts a verified Network intake and constructs its self-hosted session server-side", async () => {
    const token = await context.idp.token();
    const response = await postReview(await pendingNetworkReview(), token);

    expect(response.status).toBe(201);
    const body = (await response.json()) as { review: { record: Record<string, unknown> } };
    expect(body.review.record).toMatchObject({
      recordVersion: "2",
      storage: { kind: "append-only-review-store" },
      session: {
        runtimeMode: "self-hosted",
        analysisMode: "offline",
        source: "uploaded-offline-artifact",
        provenance: "uploaded-offline-artifact",
        capabilities: { durableDecision: true },
      },
      createdAtUtc: "2026-07-30T05:00:00.000Z",
      owner: {
        tenantId: context.idp.issuer,
        issuer: context.idp.issuer,
        subject: "user-alice",
        scope: "self-hosted-review",
      },
    });
    expect(body.review.record).not.toHaveProperty("receipt");
    expect(context.reviews.count()).toBe(1);
    expect(context.ledger.count()).toBe(0);
  });

  it("rejects caller-supplied session, receipt, findings, and risk claims before queueing", async () => {
    const intake = await pendingNetworkReview();
    const response = await postReview(
      {
        ...intake,
        session: { runtimeMode: "public-replay" },
        receipt: { receiptId: "forged-receipt" },
        findings: [],
        riskLevel: "LOW",
      },
      await context.idp.token(),
    );

    expect(response.status).toBe(422);
    expect(context.reviews.count()).toBe(0);
    expect(context.ledger.count()).toBe(0);
  });

  it("normalizes collector claims to uploaded artifacts and uses only the injected server clock", async () => {
    const intake = await pendingTerraformReview("review-normalized-collector");
    const response = await postReview(
      {
        ...intake,
        // A queue timestamp is server-owned. Keeping it in the request is a
        // schema error rather than an ambiguous client time claim.
        createdAtUtc: "2000-01-01T00:00:00.000Z",
      },
      await context.idp.token(),
    );
    expect(response.status).toBe(422);
    expect(context.reviews.count()).toBe(0);

    const accepted = await postReview(intake, await context.idp.token());
    expect(accepted.status).toBe(201);
    const body = (await accepted.json()) as { review: { record: { createdAtUtc: string; intake: { source: { origin: string; untrustedArtifactObservedAtUtc: string } } } } };
    expect(body.review.record.createdAtUtc).toBe("2026-07-30T05:00:00.000Z");
    expect(body.review.record.intake.source).toEqual(expect.objectContaining({
      origin: "uploaded-offline-artifact",
      untrustedArtifactObservedAtUtc: "2026-07-30T03:00:00.000Z",
    }));
  });

  it("accepts a verified Terraform external-diff intake without simulation authority", async () => {
    const response = await postReview(await pendingTerraformReview(), await context.idp.token());

    expect(response.status).toBe(201);
    expect((await response.json()) as { review: { record: unknown } }).toMatchObject({
      review: {
        record: {
          session: {
            domainId: "terraform",
            domainShape: "external-diff",
            source: "uploaded-offline-artifact",
            provenance: "uploaded-offline-artifact",
            capabilities: { sandboxSimulation: false, durableDecision: true },
          },
        },
      },
    });
    expect(context.ledger.count()).toBe(0);
  });

  it("rejects unsupported Kubernetes intake before a queue or ledger write", async () => {
    const intake = await pendingNetworkReview("review-kubernetes-one");
    const response = await postReview(
      {
        ...intake,
        intake: {
          ...intake.intake,
          domainId: "kubernetes",
          source: { ...intake.intake.source, domainId: "kubernetes" },
        },
      },
      await context.idp.token(),
    );

    expect(response.status).toBe(422);
    expect(context.reviews.count()).toBe(0);
    expect(context.ledger.count()).toBe(0);
  });

  it("rejects an intake id that does not name the validated domain input", async () => {
    const intake = await pendingNetworkReview("review-network-wrong-input");
    const response = await postReview(
      {
        ...intake,
        intake: {
          ...intake.intake,
          input: { ...intake.intake.input, inputId: "caller-invented-input" },
        },
      },
      await context.idp.token(),
    );

    expect(response.status).toBe(400);
    expect(context.reviews.count()).toBe(0);
    expect(context.ledger.count()).toBe(0);
  });

  it("requires a hash-bound Network proposal before queueing a current review", async () => {
    const candidate = await pendingNetworkReview("review-network-missing-proposal");
    const { proposal: _proposal, ...withoutProposal } = candidate.intake;
    void _proposal;

    const response = await postReview(
      { ...candidate, intake: withoutProposal },
      await context.idp.token(),
    );

    expect(response.status).toBe(422);
    expect(context.reviews.count()).toBe(0);
    expect(context.ledger.count()).toBe(0);
  });

  it("lists bounded pending reviews and reads one by immutable id", async () => {
    const token = await context.idp.token();
    await postReview(await pendingNetworkReview("review-network-one"), token);
    await postReview(await pendingNetworkReview("review-network-two"), token);

    const listed = await fetch(`${context.baseUrl}/reviews?domainId=network&limit=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { reviews: unknown[] }).reviews).toHaveLength(1);

    const detail = await fetch(`${context.baseUrl}/reviews/review-network-one`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.status).toBe(200);
    expect((await detail.json()) as { review: { reviewId: string } }).toMatchObject({
      review: { reviewId: "review-network-one" },
    });

    const missing = await fetch(`${context.baseUrl}/reviews/review-not-present`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.status).toBe(404);
  });

  it("keeps advancing-clock retries idempotent and gives each principal its own review-id namespace", async () => {
    const alice = await context.idp.token();
    const bob = await context.idp.token({ sub: "user-bob", email: "bob@example.test" });
    const intake = await pendingNetworkReview("review-owner-bound");
    const [first, retry] = await Promise.all([
      postReview(intake, alice),
      postReview(intake, alice),
    ]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    const firstBody = (await first.json()) as { review: { createdAtUtc: string } };
    const retryBody = (await retry.json()) as { review: { createdAtUtc: string } };
    expect(retryBody.review.createdAtUtc).toBe(firstBody.review.createdAtUtc);
    expect(context.reviews.count()).toBe(1);

    const bobList = await fetch(`${context.baseUrl}/reviews`, { headers: { authorization: `Bearer ${bob}` } });
    expect(bobList.status).toBe(200);
    expect((await bobList.json()) as { reviews: unknown[] }).toEqual({ reviews: [] });
    const bobDetail = await fetch(`${context.baseUrl}/reviews/review-owner-bound`, { headers: { authorization: `Bearer ${bob}` } });
    expect(bobDetail.status).toBe(404);

    // The same caller-chosen id is unused inside Bob's namespace. Creating it
    // has exactly the same response shape/status as creating any fresh id.
    const bobCreate = await postReview(intake, bob);
    expect(bobCreate.status).toBe(201);
    expect(Object.keys((await bobCreate.json()) as object)).toEqual(["review"]);
    expect(context.reviews.count()).toBe(2);

    const aliceDetail = await fetch(`${context.baseUrl}/reviews/review-owner-bound`, { headers: { authorization: `Bearer ${alice}` } });
    const bobOwnDetail = await fetch(`${context.baseUrl}/reviews/review-owner-bound`, { headers: { authorization: `Bearer ${bob}` } });
    expect(aliceDetail.status).toBe(200);
    expect(bobOwnDetail.status).toBe(200);
    expect(((await aliceDetail.json()) as { review: { record: { owner: { subject: string } } } }).review.record.owner.subject).toBe("user-alice");
    expect(((await bobOwnDetail.json()) as { review: { record: { owner: { subject: string } } } }).review.record.owner.subject).toBe("user-bob");
  });
});

describe("durable review decision HTTP API", () => {
  const aliceOwner = () => ({
    tenantId: context.idp.issuer,
    issuer: context.idp.issuer,
    subject: "user-alice",
    scope: "self-hosted-review",
  } as const);

  it("recomputes a stored Network proposal, signs and ledgers it, then binds the resolution", async () => {
    const token = await context.idp.token();
    expect((await postReview(await pendingNetworkReview("review-network-decide"), token)).status).toBe(201);

    const response = await decideReview("review-network-decide", { decision: "approve" }, token);

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      record: unknown;
      resolution: { receiptId: string; receiptSha256: string };
      ledgerSeq: number;
    };
    const signed = SignedReceiptSchema.parse(body.record);
    expect(signed.receipt).toMatchObject({
      sourceId: "network-source-one",
      inputId: "inc-uplink-degraded-4821",
      proposalId: (networkProposal as { proposalId: string }).proposalId,
      decision: "approved",
      approver: { subject: "user-alice", issuer: context.idp.issuer },
    });
    expect(signed.receipt.simulation).not.toBeNull();
    expect(body.ledgerSeq).toBe(1);
    expect(body.resolution).toMatchObject({
      receiptId: signed.receipt.receiptId,
      receiptSha256: signed.receipt.receiptSha256,
    });
    expect(context.ledger.count()).toBe(1);
    expect(
      context.reviews.getResolution("review-network-decide", aliceOwner())?.resolution.receipt,
    ).toMatchObject({
      receiptId: signed.receipt.receiptId,
      proposalSha256: signed.receipt.proposalSha256,
    });
  });

  it("derives Terraform from the stored plan and accepts only human decision intent", async () => {
    const token = await context.idp.token();
    expect((await postReview(await pendingTerraformReview("review-terraform-decide"), token)).status).toBe(201);

    const forged = await decideReview(
      "review-terraform-decide",
      {
        decision: "reject",
        proposal: { proposalId: "caller-proposal" },
        findings: [],
        riskLevel: "LOW",
        receipt: { receiptId: "caller-receipt" },
      },
      token,
    );
    expect(forged.status).toBe(422);
    expect(context.ledger.count()).toBe(0);

    const response = await decideReview("review-terraform-decide", { decision: "reject" }, token);
    const responseBody = await response.text();
    expect(response.status, responseBody).toBe(201);
    const body = JSON.parse(responseBody) as { record: unknown };
    const signed = SignedReceiptSchema.parse(body.record);
    expect(signed.receipt).toMatchObject({
      sourceId: "terraform-source-one",
      decision: "rejected",
      simulation: null,
    });
    expect(context.ledger.count()).toBe(1);
  });

  it("does not let another owner discover or decide a pending review", async () => {
    const alice = await context.idp.token();
    const bob = await context.idp.token({ sub: "user-bob", email: "bob@example.test" });
    expect((await postReview(await pendingNetworkReview("review-owner-decision"), alice)).status).toBe(201);

    const response = await decideReview("review-owner-decision", { decision: "approve" }, bob);

    expect(response.status).toBe(404);
    expect(context.ledger.count()).toBe(0);
    expect(context.reviews.getResolution("review-owner-decision", aliceOwner())).toBeNull();
  });

  it("refuses BLOCK approval in the state machine without a ledger entry or resolution", async () => {
    const token = await context.idp.token();
    expect((await postReview(await pendingBlockedNetworkReview(), token)).status).toBe(201);

    const response = await decideReview("review-network-blocked", { decision: "approve" }, token);

    expect(response.status).toBe(409);
    expect(context.ledger.count()).toBe(0);
    expect(context.reviews.getResolution("review-network-blocked", aliceOwner())).toBeNull();
  });

  it("keeps Kubernetes explicitly outside the durable decision contract", async () => {
    const token = await context.idp.token();
    expect((await postReview(await pendingNetworkReview("review-no-kubernetes"), token)).status).toBe(201);

    const response = await decideReview(
      "review-no-kubernetes",
      { decision: "approve", domain: "kubernetes" },
      token,
    );

    expect(response.status).toBe(422);
    expect(context.ledger.count()).toBe(0);
  });

  it("never binds a durable resolution when the receipt ledger append fails", async () => {
    const token = await context.idp.token();
    expect((await postReview(await pendingNetworkReview("review-ledger-failure"), token)).status).toBe(201);
    context.ledger.close();
    context.ledgerOpen = false;

    const response = await decideReview("review-ledger-failure", { decision: "approve" }, token);

    expect(response.status).toBe(500);
    expect(context.reviews.getResolution("review-ledger-failure", aliceOwner())).toBeNull();
  });

  it("serializes concurrent intents so one review produces one ledgered resolution", async () => {
    const token = await context.idp.token();
    expect((await postReview(await pendingNetworkReview("review-concurrent-decision"), token)).status).toBe(201);

    const responses = await Promise.all([
      decideReview("review-concurrent-decision", { decision: "reject" }, token),
      decideReview("review-concurrent-decision", { decision: "reject" }, token),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(context.ledger.count()).toBe(1);
    expect(context.reviews.getResolution("review-concurrent-decision", aliceOwner())).not.toBeNull();
  });
});
