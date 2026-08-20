import { z } from "zod";
import { IdSchema, Sha256HexSchema, TimestampSchema } from "./primitives";

/**
 * What kind of admission request the grant authorizes, mirroring the
 * Kubernetes admission.k8s.io/v1 `operation` field exactly so an enforcement
 * point can compare without translation.
 */
export const GrantOperationSchema = z.enum(["CREATE", "UPDATE", "DELETE", "CONNECT"]);

/**
 * Binds one prior decision (`receiptId`) to exactly one actor, operation,
 * resource, and object state that may exercise it at an enforcement
 * boundary. Deliberately domain-agnostic: `resource` and `objectSha256` are
 * opaque strings a domain's own normalization pipeline produces — core does
 * not know they came from Kubernetes.
 *
 * Minimal shape per docs/STRATEGY.md M2: extend only when a counterexample
 * demands it (nonce, use-state, revocation, ...), never speculatively.
 */
export const AuthorizationGrantSchema = z
  .strictObject({
    grantId: IdSchema,
    /** The approved `ChangeReceipt` this grant was issued from. */
    receiptId: IdSchema,
    /**
     * The identity that may exercise this grant, in the enforcement
     * boundary's own vocabulary (e.g. Kubernetes' `userInfo.username`).
     * Never a ChangeSafe-owned identity or claim.
     */
    authorizedActor: z.string().min(1).max(255),
    operation: GrantOperationSchema,
    /** Opaque stable resource identifier from the domain's own scheme. */
    resource: z.string().min(1).max(128),
    /** Hash of the domain-normalized object this grant was issued against. */
    objectSha256: Sha256HexSchema,
    /**
     * The composed policy version of the receipt this grant came from, e.g.
     * `core-v0.2.0+kubernetes-v0.1.0`. Bounded generously: real composed
     * values are already ~30 characters, so a tighter bound would start
     * rejecting legitimate receipts after a couple of version-digit growths.
     */
    policyVersion: z.string().min(1).max(64),
    issuedAtUtc: TimestampSchema,
    expiresAtUtc: TimestampSchema,
  })
  .superRefine((grant, ctx) => {
    if (Date.parse(grant.expiresAtUtc) <= Date.parse(grant.issuedAtUtc)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAtUtc"],
        message: "expiresAtUtc must be strictly after issuedAtUtc",
      });
    }
  });

export type AuthorizationGrant = z.infer<typeof AuthorizationGrantSchema>;
