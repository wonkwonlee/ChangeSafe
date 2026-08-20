import { describe, expect, it } from "vitest";
import { AuthorizationGrantSchema } from "../src/grant";

function buildGrant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    grantId: "grant-0000000000000000000000000000000001",
    receiptId: "rcpt-test-0001",
    authorizedActor: "system:serviceaccount:ops:changesafe-applier",
    operation: "UPDATE",
    resource: "res-0123456789abcdef",
    objectSha256: "a".repeat(64),
    policyVersion: "kubernetes-v0.2.0",
    issuedAtUtc: "2026-08-19T12:00:00.000Z",
    expiresAtUtc: "2026-08-19T13:00:00.000Z",
    ...overrides,
  };
}

describe("AuthorizationGrantSchema", () => {
  it("accepts a well-formed grant", () => {
    expect(AuthorizationGrantSchema.safeParse(buildGrant()).success).toBe(true);
  });

  it("rejects an unknown operation", () => {
    expect(
      AuthorizationGrantSchema.safeParse(buildGrant({ operation: "PATCH" })).success,
    ).toBe(false);
  });

  it("rejects a non-hex objectSha256", () => {
    expect(
      AuthorizationGrantSchema.safeParse(buildGrant({ objectSha256: "not-a-hash" })).success,
    ).toBe(false);
  });

  it("rejects expiresAtUtc at or before issuedAtUtc", () => {
    expect(
      AuthorizationGrantSchema.safeParse(
        buildGrant({ issuedAtUtc: "2026-08-19T13:00:00.000Z", expiresAtUtc: "2026-08-19T13:00:00.000Z" }),
      ).success,
    ).toBe(false);
    expect(
      AuthorizationGrantSchema.safeParse(
        buildGrant({ issuedAtUtc: "2026-08-19T13:00:00.000Z", expiresAtUtc: "2026-08-19T12:00:00.000Z" }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown fields (strict object)", () => {
    expect(
      AuthorizationGrantSchema.safeParse({ ...buildGrant(), extra: "nope" }).success,
    ).toBe(false);
  });
});
