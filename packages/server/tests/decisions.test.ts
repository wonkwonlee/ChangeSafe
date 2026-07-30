import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChangeReceiptSchema, generateSigningKeyPair, importSigningKeyPair } from "@changesafe/core";
import { Ledger } from "@changesafe/ledger";

import { DecisionService } from "../src/decisions";
import { createDecisionServer } from "../src/http";
import { OidcVerifier } from "../src/oidc";
import { FakeIdp } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(here, "../../../scenarios/network");

function scenario(name: string) {
  const read = (file: string) =>
    JSON.parse(readFileSync(path.join(scenarios, name, file), "utf8")) as Record<string, unknown>;
  const fixture = read("replay-fixture.json");
  return { incident: read("incident.json"), proposal: fixture.proposal };
}

const SAFE = scenario("scenario-a-failover");
const BLOCKED = scenario("scenario-b-route-leak");

let context: {
  idp: FakeIdp;
  ledger: Ledger;
  baseUrl: string;
  close: () => Promise<void>;
};

beforeEach(async () => {
  const idp = await FakeIdp.create();
  const ledger = Ledger.open(":memory:");
  const pem = await generateSigningKeyPair();

  const server = createDecisionServer({
    ledger,
    verifier: new OidcVerifier(
      { issuer: idp.issuer, audience: "changesafe", jwksUri: `${idp.issuer}/jwks` },
      { fetch: idp.fetch() },
    ),
    decisions: new DecisionService({
      ledger,
      appVersion: "changesafe-server-test",
      signingKeyPair: await importSigningKeyPair(pem.privateKeyPem),
    }),
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  context = {
    idp,
    ledger,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ledger.close();
    },
  };
});

afterEach(async () => {
  await context.close();
});

async function decide(body: unknown, token?: string) {
  return fetch(`${context.baseUrl}/decisions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const safeApproval = {
  domain: "network",
  sourceId: "scenario-a-failover",
  input: SAFE.incident,
  proposal: SAFE.proposal,
  decision: "approve",
};

describe("authentication", () => {
  it("refuses an unauthenticated decision", async () => {
    const response = await decide(safeApproval);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(context.ledger.count()).toBe(0);
  });

  it("refuses a token from another issuer", async () => {
    const attacker = await FakeIdp.create();
    const response = await decide(safeApproval, await attacker.token());
    expect(response.status).toBe(401);
    expect(context.ledger.count()).toBe(0);
  });

  it("serves health without a token, and nothing else", async () => {
    expect((await fetch(`${context.baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${context.baseUrl}/decisions`)).status).toBe(401);
    expect((await fetch(`${context.baseUrl}/ledger/verify`)).status).toBe(401);
  });
});

describe("deciding", () => {
  it("approves a clean change and records who approved it", async () => {
    const response = await decide(safeApproval, await context.idp.token());
    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, never>;
    const receipt = ChangeReceiptSchema.parse(
      (body.record as unknown as { receipt: unknown }).receipt,
    );

    expect(receipt.decision).toBe("approved");
    expect(receipt.approver).toEqual({
      subject: "user-alice",
      issuer: context.idp.issuer,
      email: "alice@example.test",
    });
    // Approval implies simulation, and the schema refuses one without it.
    expect(receipt.simulation).not.toBeNull();
  });

  it("records the decision in the ledger before answering", async () => {
    await decide(safeApproval, await context.idp.token());
    expect(context.ledger.count()).toBe(1);
    expect((await context.ledger.verifyChain()).ok).toBe(true);
  });

  it("signs the issued receipt", async () => {
    const response = await decide(safeApproval, await context.idp.token());
    const body = (await response.json()) as { record: { signature?: { publicKeyId: string } } };
    expect(body.record.signature?.publicKeyId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("rejects a change and records that too", async () => {
    const response = await decide(
      { ...safeApproval, decision: "reject" },
      await context.idp.token(),
    );
    expect(response.status).toBe(201);
    const entry = context.ledger.list()[0];
    expect(entry?.decision).toBe("rejected");
  });
});

describe("what authentication does not buy", () => {
  it("still cannot approve a change with blocking findings", async () => {
    // The whole point: an authenticated, authorized, entirely legitimate
    // operator has no more power to approve a BLOCK than an anonymous one.
    const response = await decide(
      {
        domain: "network",
        sourceId: "scenario-b-route-leak",
        input: BLOCKED.incident,
        proposal: BLOCKED.proposal,
        decision: "approve",
      },
      await context.idp.token(),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/cannot be approved by anyone/);
    expect(context.ledger.count()).toBe(0);
  });

  it("ignores findings the client claims, recomputing them server-side", async () => {
    // A client that says "the gate passed this" changes nothing, because the
    // server never reads that claim — it evaluates the policies itself.
    const response = await decide(
      {
        domain: "network",
        sourceId: "scenario-b-route-leak",
        input: BLOCKED.incident,
        proposal: BLOCKED.proposal,
        decision: "approve",
        findings: [{ policyId: "PATCH_SCHEMA", status: "PASS" }],
        riskLevel: "LOW",
      },
      await context.idp.token(),
    );

    // Rejected as an unknown field before it could even be considered.
    expect(response.status).toBe(422);
    expect(context.ledger.count()).toBe(0);
  });

  it("refuses a proposal citing evidence the input does not contain", async () => {
    const tampered = structuredClone(SAFE.proposal) as {
      diagnosis: { evidenceIds: string[] };
    };
    tampered.diagnosis.evidenceIds = ["ev-invented-001"];

    const response = await decide(
      { ...safeApproval, proposal: tampered },
      await context.idp.token(),
    );
    expect(response.status).toBe(422);
    expect(context.ledger.count()).toBe(0);
  });
});

describe("reading the record", () => {
  it("lists decisions and verifies the chain for an authenticated caller", async () => {
    const token = await context.idp.token();
    await decide(safeApproval, token);
    await decide({ ...safeApproval, decision: "reject" }, token);

    const list = await fetch(`${context.baseUrl}/decisions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await list.json()) as { entries: { decision: string }[] };
    expect(body.entries).toHaveLength(2);

    const verify = await fetch(`${context.baseUrl}/ledger/verify`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(verify.status).toBe(200);
    expect(((await verify.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("has no endpoint that writes to the ledger except a decision", async () => {
    const token = await context.idp.token();
    for (const [method, route] of [
      ["DELETE", "/decisions"],
      ["POST", "/ledger"],
      ["PUT", "/ledger/verify"],
      ["POST", "/execute"],
    ] as const) {
      const response = await fetch(`${context.baseUrl}${route}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(404);
    }
  });
});
