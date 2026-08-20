import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, importSigningKeyPair, importVerifyingKey, verifyGrantSignature } from "@changesafe/core";
import { Ledger } from "@changesafe/ledger";
import { DecisionService } from "../src/decisions";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(here, "../../../scenarios/network");

function scenario(name: string) {
  const read = (file: string) =>
    JSON.parse(readFileSync(path.join(scenarios, name, file), "utf8")) as Record<string, unknown>;
  const fixture = read("replay-fixture.json");
  return { incident: read("incident.json"), proposal: fixture.proposal };
}

const SAFE = scenario("scenario-a-failover");

const NOW = "2026-08-19T12:00:00.000Z";

async function buildService() {
  const pem = await generateSigningKeyPair();
  const keyPair = await importSigningKeyPair(pem.privateKeyPem);
  const verifying = await importVerifyingKey(pem.publicKeyPem);
  const ledger = Ledger.open(":memory:");
  const decisions = new DecisionService({
    ledger,
    appVersion: "test-1.0.0",
    signingKeyPair: keyPair,
    now: () => NOW,
  });
  return { decisions, verifying };
}

describe("DecisionService.issueGrant", () => {
  it("issues a signed grant referencing an approved receipt", async () => {
    const { decisions, verifying } = await buildService();
    const outcome = await decisions.decide(
      {
        domain: "network",
        sourceId: "scenario-a-failover",
        input: SAFE.incident,
        proposal: SAFE.proposal,
        decision: "approve",
      },
      { subject: "approver-1", issuer: "https://issuer.example", email: null },
    );

    const grant = await decisions.issueGrant(outcome.receipt, {
      authorizedActor: "system:serviceaccount:ops:changesafe-applier",
      operation: "UPDATE",
      resource: "res-0123456789abcdef",
      objectSha256: "a".repeat(64),
      oldObjectSha256: "b".repeat(64),
      expiresAtUtc: "2026-08-19T13:00:00.000Z",
    });

    expect(grant.grant.receiptId).toBe(outcome.receipt.receiptId);
    expect(grant.grant.policyVersion).toBe(outcome.receipt.policyVersion);
    expect(await verifyGrantSignature(grant, verifying)).toBe("valid");
  });

  it("uses a caller-supplied issuedAtUtc instead of its own clock, closing the pre-check/issuance race", async () => {
    // The service's own clock is set far in the future relative to
    // expiresAtUtc — if issueGrant read this clock for issuedAtUtc (the
    // pre-fix behavior), AuthorizationGrantSchema would reject the grant
    // as already-expired even though the HTTP route's pre-ledger check
    // (using a different, earlier clock reading) had already let the
    // request proceed and the decision had already been ledgered. A
    // caller-supplied issuedAtUtc must take precedence so the two checks
    // stay atomic against one captured instant, not two independent reads.
    const pem = await generateSigningKeyPair();
    const keyPair = await importSigningKeyPair(pem.privateKeyPem);
    const ledger = Ledger.open(":memory:");
    const decisions = new DecisionService({
      ledger,
      appVersion: "test-1.0.0",
      signingKeyPair: keyPair,
      now: () => "2026-08-19T14:00:00.000Z", // after the grant's expiresAtUtc
    });
    const outcome = await decisions.decide(
      {
        domain: "network",
        sourceId: "scenario-a-failover",
        input: SAFE.incident,
        proposal: SAFE.proposal,
        decision: "approve",
      },
      { subject: "approver-1", issuer: "https://issuer.example", email: null },
    );

    const grant = await decisions.issueGrant(outcome.receipt, {
      authorizedActor: "system:serviceaccount:ops:changesafe-applier",
      operation: "UPDATE",
      resource: "res-0123456789abcdef",
      objectSha256: "a".repeat(64),
      oldObjectSha256: "b".repeat(64),
      expiresAtUtc: "2026-08-19T13:00:00.000Z",
      issuedAtUtc: "2026-08-19T12:00:00.000Z", // the instant a pre-check would have captured
    });

    expect(grant.grant.issuedAtUtc).toBe("2026-08-19T12:00:00.000Z");
  });

  it("refuses to issue a grant from a non-approved receipt", async () => {
    const { decisions } = await buildService();
    const outcome = await decisions.decide(
      {
        domain: "network",
        sourceId: "scenario-a-failover",
        input: SAFE.incident,
        proposal: SAFE.proposal,
        decision: "reject",
      },
      { subject: "approver-1", issuer: "https://issuer.example", email: null },
    );

    await expect(
      decisions.issueGrant(outcome.receipt, {
        authorizedActor: "system:serviceaccount:ops:changesafe-applier",
        operation: "UPDATE",
        resource: "res-0123456789abcdef",
        objectSha256: "a".repeat(64),
        expiresAtUtc: "2026-08-19T13:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
  });
});
