import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { Ledger } from "@changesafe/ledger";

import { DecisionService } from "../src/decisions";
import { createDecisionServer } from "../src/http";
import { OidcVerifier, type ApproverPolicy } from "../src/oidc";
import { FakeIdp } from "./helpers";

/**
 * Authentication establishes who someone is. These cover the separate
 * question of whether that person may act here, and the request failures that
 * must not be reported as the server having broken.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(here, "../../../scenarios");

function scenario(name: string) {
  const read = (file: string) =>
    JSON.parse(readFileSync(path.join(scenarios, name, file), "utf8")) as Record<string, unknown>;
  return { incident: read("incident.json"), proposal: read("replay-fixture.json").proposal };
}

const SAFE = scenario("scenario-a-failover");

let close: (() => Promise<void>) | null = null;

afterEach(async () => {
  await close?.();
  close = null;
});

async function serve(approvers?: ApproverPolicy) {
  const idp = await FakeIdp.create();
  const ledger = Ledger.open(":memory:");
  const server = createDecisionServer({
    ledger,
    verifier: new OidcVerifier(
      {
        issuer: idp.issuer,
        audience: "changesafe",
        jwksUri: `${idp.issuer}/jwks`,
        ...(approvers ? { approvers } : {}),
      },
      { fetch: idp.fetch() },
    ),
    decisions: new DecisionService({ ledger, appVersion: "changesafe-server-test" }),
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ledger.close();
  };
  return { idp, ledger, baseUrl: `http://127.0.0.1:${port}` };
}

const approval = {
  domain: "network",
  sourceId: "scenario-a-failover",
  input: SAFE.incident,
  proposal: SAFE.proposal,
  decision: "approve",
};

function post(baseUrl: string, body: string, token?: string) {
  return fetch(`${baseUrl}/decisions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

describe("approver policy", () => {
  it("refuses a valid token whose subject is not an approver", async () => {
    const { idp, baseUrl, ledger } = await serve({ subjects: ["user-bob"] });
    const response = await post(baseUrl, JSON.stringify(approval), await idp.token());

    // 403, not 401: the identity is real, so a fresh token changes nothing.
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(ledger.count()).toBe(0);
  });

  it("admits a listed subject", async () => {
    const { idp, baseUrl, ledger } = await serve({ subjects: ["user-alice"] });
    const response = await post(baseUrl, JSON.stringify(approval), await idp.token());

    expect(response.status).toBe(201);
    expect(ledger.count()).toBe(1);
  });

  it("requires every declared claim, matching any of its values", async () => {
    const policy: ApproverPolicy = { claims: [{ name: "groups", values: ["sre", "platform"] }] };

    const permitted = await serve(policy);
    expect(
      (
        await post(
          permitted.baseUrl,
          JSON.stringify(approval),
          await permitted.idp.token({ groups: ["dev", "platform"] }),
        )
      ).status,
    ).toBe(201);
    await close?.();
    close = null;

    const refused = await serve(policy);
    expect(
      (
        await post(
          refused.baseUrl,
          JSON.stringify(approval),
          await refused.idp.token({ groups: ["dev"] }),
        )
      ).status,
    ).toBe(403);
    // A claim the token does not carry at all is equally not a match.
    expect(
      (await post(refused.baseUrl, JSON.stringify(approval), await refused.idp.token())).status,
    ).toBe(403);
    expect(refused.ledger.count()).toBe(0);
  });

  it("never lets authorization substitute for the gate", async () => {
    const blocked = scenario("scenario-b-route-leak");
    const { idp, baseUrl, ledger } = await serve({ subjects: ["user-alice"] });

    const response = await post(
      baseUrl,
      JSON.stringify({
        domain: "network",
        sourceId: "scenario-b-route-leak",
        input: blocked.incident,
        proposal: blocked.proposal,
        decision: "approve",
      }),
      await idp.token(),
    );

    // Being on the approver list buys no power over a BLOCK.
    expect(response.status).toBe(409);
    expect(ledger.count()).toBe(0);
  });

  it("admits everyone when no policy is configured", async () => {
    const { idp, baseUrl } = await serve();
    expect((await post(baseUrl, JSON.stringify(approval), await idp.token())).status).toBe(201);
  });
});

describe("request failures report the caller's problem", () => {
  it("answers 401 for a token that cannot even be decoded", async () => {
    const { baseUrl } = await serve();
    // Three dot-separated segments, so it reaches the decoder rather than the
    // shape check — and the decoder must not throw its way to a 500.
    const response = await post(baseUrl, JSON.stringify(approval), "not.a.jwt");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("answers 401 for a syntactically valid token with no claims", async () => {
    const { baseUrl } = await serve();
    const segment = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${segment({ alg: "ES256" })}.${segment({ hello: "world" })}.AAAA`;

    expect((await post(baseUrl, JSON.stringify(approval), token)).status).toBe(401);
  });

  it("answers 413 for an oversized body", async () => {
    const { idp, baseUrl } = await serve();
    const huge = JSON.stringify({ ...approval, padding: "x".repeat(3 * 1024 * 1024) });

    const response = await post(baseUrl, huge, await idp.token());
    expect(response.status).toBe(413);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const { idp, baseUrl } = await serve();
    const response = await post(baseUrl, "{not json", await idp.token());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "REQUEST_INVALID" } });
  });

  it("treats an unreadable limit as unspecified rather than failing", async () => {
    const { idp, baseUrl } = await serve();
    const token = await idp.token();
    await post(baseUrl, JSON.stringify(approval), token);

    for (const query of ["limit=abc", "limit=2.5", "limit=-1", "limit=999999", ""]) {
      const response = await fetch(`${baseUrl}/decisions?${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status, query).toBe(200);
      const body = (await response.json()) as { entries: unknown[] };
      expect(body.entries.length, query).toBe(1);
    }
  });
});
