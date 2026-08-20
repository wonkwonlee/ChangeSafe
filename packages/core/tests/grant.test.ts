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

  it("accepts a real composed policy version with room to grow", () => {
    // What `issueGrant` actually copies off a receipt today, plus headroom:
    // a 32-character bound would already be one version-digit away from
    // rejecting a legitimate receipt.
    expect(
      AuthorizationGrantSchema.safeParse(
        buildGrant({ policyVersion: "core-v10.20.30+kubernetes-v10.20.30" }),
      ).success,
    ).toBe(true);
  });

  it("rejects an implausibly long policy version", () => {
    expect(
      AuthorizationGrantSchema.safeParse(buildGrant({ policyVersion: "v".repeat(65) })).success,
    ).toBe(false);
  });

  it("rejects unknown fields (strict object)", () => {
    expect(
      AuthorizationGrantSchema.safeParse({ ...buildGrant(), extra: "nope" }).success,
    ).toBe(false);
  });
});
