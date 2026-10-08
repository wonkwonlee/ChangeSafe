import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, importSigningKeyPair } from "@changesafe/core";
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
  const ledger = Ledger.open(":memory:");
  const decisions = new DecisionService({
    ledger,
    appVersion: "test-1.0.0",
    signingKeyPair: keyPair,
    now: () => NOW,
  });
  return { decisions };
}

describe("DecisionService.issueGrant", () => {
  it("cannot mint an unrelated capability from a valid Network approval", async () => {
    const { decisions } = await buildService();
    const request = { domain: "network", sourceId: "scenario-a-failover", input: SAFE.incident,
      proposal: SAFE.proposal, decision: "approve" as const };
    const outcome = await decisions.decide(request,
      { subject: "approver-1", issuer: "https://issuer.example", email: null });
    const preferences = { authorizedActor: "system:serviceaccount:ops:applier", expiresAtUtc: "2026-08-19T13:00:00.000Z" };
    await expect(decisions.issueGrant(outcome.receipt, preferences)).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    await expect(decisions.issueGrant(outcome.receipt, preferences, request)).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });
  it("refuses a rejected receipt", async () => {
    const { decisions } = await buildService();
    const request = { domain: "network", sourceId: "scenario-a-failover", input: SAFE.incident,
      proposal: SAFE.proposal, decision: "reject" as const };
    const outcome = await decisions.decide(request,
      { subject: "approver-1", issuer: "https://issuer.example", email: null });
    await expect(decisions.issueGrant(outcome.receipt, {
      authorizedActor: "actor-test", expiresAtUtc: "2026-08-19T13:00:00.000Z",
    }, request)).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
  });
});
