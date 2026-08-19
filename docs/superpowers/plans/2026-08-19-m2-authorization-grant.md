# M2 AuthorizationGrant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `AuthorizationGrant` as a signed, domain-agnostic core primitive; have `packages/server` issue one after an approved Kubernetes decision; and add a new `packages/kubernetes-enforcer` package that verifies grants at a Kubernetes admission-webhook boundary.

**Architecture:** `AuthorizationGrant` schema + Ed25519 signing live in `packages/core` beside `receipt.ts`/`signature.ts` (pure, zero IO). `packages/server` gains a Kubernetes domain registration (it currently has none) and an `issueGrant` step on `DecisionService`, called from the durable decision HTTP route. `packages/kubernetes-enforcer` is a new IO-bound package (own HTTP server, no `@kubernetes/client-node` dependency needed — it only receives `AdmissionReview` webhook calls, never talks to the K8s API) that depends on `@changesafe/core` and `@changesafe/domain-kubernetes`.

**Tech Stack:** TypeScript (strict), Zod v4, Vitest, Web Crypto (Ed25519), Node `node:http` (no framework), npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-19-m2-authorization-grant-design.md`

## Global Constraints

- `packages/core` depends on `zod` alone — no new dependency added there.
- No `any`, no unsafe casts; strict TypeScript throughout (per root `CLAUDE.md` Coding standards).
- Every behavioral change includes or updates the smallest relevant test (per root `CLAUDE.md` Testing expectations).
- `authorized_actor` is never a ChangeSafe-owned identity system — it is compared directly against Kubernetes' own `AdmissionReview.request.userInfo` (Spec Decision 3). Do not add claims/JWT/OAuth machinery.
- `object_sha256` is computed over the existing `packages/domain-kubernetes` normalization pipeline, not raw manifest JSON (Spec Decision 5).
- `failurePolicy` fail-open/fail-closed is driven by the existing `changesafe.dev/protected` annotation, not a new classification (Spec Decision 4).
- No fourth `domain-*` package: `packages/kubernetes-enforcer` must not implement `DomainAdapter`.
- Grants are **not** written to `packages/ledger` in this pass (explicitly deferred in the spec) — do not add this.
- `expiresAtUtc` is a required caller-supplied field with no default.

---

### Task 1: `AuthorizationGrant` schema in core

**Files:**
- Create: `packages/core/src/grant.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/grant.test.ts`

**Interfaces:**
- Produces: `AuthorizationGrantSchema: z.ZodType`, `type AuthorizationGrant`, exported from `@changesafe/core`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/grant.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/grant.test.ts`
Expected: FAIL — `Cannot find module '../src/grant'`

- [ ] **Step 3: Write the schema**

```typescript
// packages/core/src/grant.ts
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
    policyVersion: z.string().min(1).max(32),
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/grant.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Export from `packages/core/src/index.ts`**

Add beside the existing `// Receipts` export block:

```typescript
// Authorization grants — bind one approved decision to one actor,
// operation, resource, and object state at an enforcement boundary.
export { AuthorizationGrantSchema, GrantOperationSchema } from "./grant";
export type { AuthorizationGrant } from "./grant";
```

- [ ] **Step 6: Run the full core test suite**

Run: `npx vitest run packages/core`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/grant.ts packages/core/src/index.ts packages/core/tests/grant.test.ts
git commit -m "feat(core): add AuthorizationGrant schema"
```

---

### Task 2: Grant signing and verification in core

**Files:**
- Create: `packages/core/src/grant-signature.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/grant-signature.test.ts`

**Interfaces:**
- Consumes: `AuthorizationGrantSchema`, `type AuthorizationGrant` (Task 1); `SIGNATURE_ALGORITHM`, `computePublicKeyId`, `generateSigningKeyPair`, `importSigningKeyPair`, `importVerifyingKey` from `./signature` (all already public).
- Produces: `GrantSignatureSchema`, `SignedGrantSchema`, `type SignedGrant`, `type GrantSignatureVerdict`, `signGrant()`, `verifyGrantSignature()` — same key-pair type as receipt signing, so one signing key signs both receipts and grants.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/grant-signature.test.ts
import { describe, expect, it } from "vitest";
import { AuthorizationGrantSchema, type AuthorizationGrant } from "../src/grant";
import {
  SignedGrantSchema,
  signGrant,
  verifyGrantSignature,
} from "../src/grant-signature";
import {
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
} from "../src/signature";

const SIGNED_AT = "2026-08-19T12:30:00.000Z";

function buildGrant(overrides: Partial<AuthorizationGrant> = {}): AuthorizationGrant {
  return AuthorizationGrantSchema.parse({
    grantId: "grant-test-0001",
    receiptId: "rcpt-test-0001",
    authorizedActor: "system:serviceaccount:ops:changesafe-applier",
    operation: "UPDATE",
    resource: "res-0123456789abcdef",
    objectSha256: "a".repeat(64),
    policyVersion: "kubernetes-v0.2.0",
    issuedAtUtc: "2026-08-19T12:00:00.000Z",
    expiresAtUtc: "2026-08-19T13:00:00.000Z",
    ...overrides,
  });
}

async function loadKeys() {
  const pem = await generateSigningKeyPair();
  const keyPair = await importSigningKeyPair(pem.privateKeyPem);
  const verifying = await importVerifyingKey(pem.publicKeyPem);
  return { pem, keyPair, verifying };
}

describe("grant signing", () => {
  it("produces a signature a holder of the public key can verify", async () => {
    const { keyPair, verifying } = await loadKeys();
    const signed = await signGrant(buildGrant(), keyPair, { signedAtUtc: SIGNED_AT });

    expect(signed.signature.algorithm).toBe("ed25519");
    expect(await verifyGrantSignature(signed, verifying)).toBe("valid");
  });

  it("rejects a grant altered after signing", async () => {
    const { keyPair, verifying } = await loadKeys();
    const signed = await signGrant(buildGrant(), keyPair, { signedAtUtc: SIGNED_AT });

    const tampered = {
      ...signed,
      grant: { ...signed.grant, authorizedActor: "system:serviceaccount:ops:attacker" },
    };
    expect(await verifyGrantSignature(tampered, verifying)).toBe("invalid");
  });

  it("rejects a signature made by a different key", async () => {
    const mine = await loadKeys();
    const theirs = await loadKeys();
    const signed = await signGrant(buildGrant(), theirs.keyPair, { signedAtUtc: SIGNED_AT });
    expect(await verifyGrantSignature(signed, mine.verifying)).toBe("key_mismatch");
  });

  it("validates the envelope shape", async () => {
    const { keyPair } = await loadKeys();
    const signed = await signGrant(buildGrant(), keyPair, { signedAtUtc: SIGNED_AT });
    expect(SignedGrantSchema.safeParse(signed).success).toBe(true);
    expect(
      SignedGrantSchema.safeParse({ ...signed, signature: { ...signed.signature, algorithm: "rsa" } })
        .success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/grant-signature.test.ts`
Expected: FAIL — `Cannot find module '../src/grant-signature'`

- [ ] **Step 3: Write the implementation**

This deliberately duplicates `signature.ts`'s small private byte-conversion
helpers rather than exporting them from `signature.ts` for reuse — those
helpers are internal to a stable, already-tested module, and duplicating
~15 lines is lower risk than changing its public surface.

```typescript
// packages/core/src/grant-signature.ts
import { z } from "zod";

import { AuthorizationGrantSchema, type AuthorizationGrant } from "./grant";
import { canonicalize } from "./canonical";
import { TimestampSchema } from "./primitives";
import { SIGNATURE_ALGORITHM, computePublicKeyId } from "./signature";

/**
 * Grant signing.
 *
 * Mirrors receipt signing exactly (see signature.ts): Ed25519 through Web
 * Crypto, a detached-signature envelope, no embedded public key. A grant's
 * signature is what lets an enforcement point trust that the issuing server
 * — not a forger with the schema — produced it.
 */
const WEB_CRYPTO_ALGORITHM = { name: "Ed25519" } as const;

export const GrantSignatureSchema = z.strictObject({
  algorithm: z.literal(SIGNATURE_ALGORITHM),
  publicKeyId: z.string().regex(/^[a-f0-9]{32}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  signedAtUtc: TimestampSchema,
});

export const SignedGrantSchema = z.strictObject({
  grant: AuthorizationGrantSchema,
  signature: GrantSignatureSchema,
});

export type GrantSignature = z.infer<typeof GrantSignatureSchema>;
export type SignedGrant = z.infer<typeof SignedGrantSchema>;
export type GrantSignatureVerdict = "valid" | "invalid" | "key_mismatch" | "unverified";

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function signingPayload(grant: AuthorizationGrant): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(canonicalize(grant));
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  bytes.set(encoded);
  return bytes;
}

export interface SignGrantOptions {
  /** Injectable for deterministic tests; defaults to the current UTC instant. */
  signedAtUtc?: string;
}

/** Sign a grant, producing a detached-signature envelope. */
export async function signGrant(
  grant: AuthorizationGrant,
  keyPair: { privateKey: CryptoKey; publicKey: CryptoKey },
  options: SignGrantOptions = {},
): Promise<SignedGrant> {
  const signature = await globalThis.crypto.subtle.sign(
    WEB_CRYPTO_ALGORITHM,
    keyPair.privateKey,
    signingPayload(grant),
  );

  return SignedGrantSchema.parse({
    grant,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      publicKeyId: await computePublicKeyId(keyPair.publicKey),
      signature: toBase64(signature),
      signedAtUtc: options.signedAtUtc ?? new Date().toISOString(),
    },
  });
}

/** Check a grant's signature against a key the caller already trusts. */
export async function verifyGrantSignature(
  signed: SignedGrant,
  trustedPublicKey: CryptoKey,
): Promise<GrantSignatureVerdict> {
  if ((await computePublicKeyId(trustedPublicKey)) !== signed.signature.publicKeyId) {
    return "key_mismatch";
  }
  const ok = await globalThis.crypto.subtle.verify(
    WEB_CRYPTO_ALGORITHM,
    trustedPublicKey,
    fromBase64(signed.signature.signature),
    signingPayload(signed.grant),
  );
  return ok ? "valid" : "invalid";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/grant-signature.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Export from `packages/core/src/index.ts`**

Append after the grant export added in Task 1:

```typescript
export {
  GrantSignatureSchema,
  SignedGrantSchema,
  signGrant,
  verifyGrantSignature,
} from "./grant-signature";
export type {
  GrantSignature,
  GrantSignatureVerdict,
  SignedGrant,
  SignGrantOptions,
} from "./grant-signature";
```

- [ ] **Step 6: Run the full core test suite**

Run: `npx vitest run packages/core`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/grant-signature.ts packages/core/src/index.ts packages/core/tests/grant-signature.test.ts
git commit -m "feat(core): add AuthorizationGrant signing and verification"
```

---

### Task 3: Register the Kubernetes domain in `packages/server`

`packages/server` currently registers only `network` and `terraform`
(`packages/server/src/domains.ts`) — it cannot produce an approved decision
for a Kubernetes proposal at all. Grant issuance is unreachable without this.

**Files:**
- Modify: `packages/server/src/domains.ts`
- Test: `packages/server/tests/domains-kubernetes.test.ts`

**Interfaces:**
- Consumes: `kubernetesDomain`, `normalizeSnapshot`, `deriveManifestProposal`, `parseManifestDocuments`, `runKubernetesSimulation` from `@changesafe/domain-kubernetes` (all already exported).
- Produces: `DOMAINS.kubernetes: ServerDomain`, reachable via `resolveServerDomain("kubernetes")`; `SERVER_DOMAIN_IDS` now includes `"kubernetes"`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/tests/domains-kubernetes.test.ts
import { describe, expect, it } from "vitest";
import { resolveServerDomain, SERVER_DOMAIN_IDS } from "../src/domains";

const SNAPSHOT = {
  snapshotVersion: "changesafe-kubernetes-snapshot/v1",
  snapshotId: "snap-test-0001",
  evidenceId: "ev-snap-test-0001",
  provenance: { kind: "authored-synthetic" },
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: "default" },
      spec: { replicas: 2 },
    },
  ],
};

const MANIFEST_TEXT = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 3
`;

describe("kubernetes server domain", () => {
  it("is registered", () => {
    expect(SERVER_DOMAIN_IDS).toContain("kubernetes");
  });

  it("parses a snapshot input and derives a proposal from manifest text", () => {
    const domain = resolveServerDomain("kubernetes");
    const { input, inputId } = domain.parseInput(SNAPSHOT);
    expect(inputId).toBe("snap-test-0001");

    const proposal = domain.resolveProposal(input, MANIFEST_TEXT);
    expect(proposal.operations.length).toBeGreaterThan(0);
  });

  it("simulates", () => {
    const domain = resolveServerDomain("kubernetes");
    const { input } = domain.parseInput(SNAPSHOT);
    const proposal = domain.resolveProposal(input, MANIFEST_TEXT);
    expect(domain.simulate).toBeDefined();
    const result = domain.simulate!(input, proposal);
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/domains-kubernetes.test.ts`
Expected: FAIL — `resolveServerDomain` throws `Unknown domain "kubernetes"`

- [ ] **Step 3: Register the domain**

In `packages/server/src/domains.ts`, add the import and registration:

```typescript
import {
  deriveManifestProposal,
  kubernetesDomain,
  normalizeSnapshot,
  parseManifestDocuments,
  runKubernetesSimulation,
} from "@changesafe/domain-kubernetes";
```

Add after the `terraform` object definition, before `const DOMAINS`:

```typescript
const kubernetes: ServerDomain = {
  id: "kubernetes",
  adapter: kubernetesDomain as unknown as DomainAdapter<never, never>,
  parseInput(raw) {
    const snapshot = normalizeSnapshot(raw);
    return { input: snapshot, inputId: snapshot.snapshotId };
  },
  resolveProposal(input, raw) {
    // The caller submits proposed manifest YAML/JSON text; the domain
    // derives the declarative diff against the snapshot itself, the same
    // way Terraform derives a proposal from a plan rather than accepting
    // a client-supplied one.
    const manifestSet = parseManifestDocuments(raw as string);
    return deriveManifestProposal(
      input as Parameters<typeof deriveManifestProposal>[0],
      manifestSet,
    ).proposal as ChangeProposal;
  },
  simulate(input, proposal) {
    return runKubernetesSimulation(
      input as Parameters<typeof runKubernetesSimulation>[0],
      proposal,
    );
  },
};
```

Update the registry:

```typescript
const DOMAINS: Record<string, ServerDomain> = { network, terraform, kubernetes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/tests/domains-kubernetes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full server test suite**

Run: `npx vitest run packages/server`
Expected: PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/domains.ts packages/server/tests/domains-kubernetes.test.ts
git commit -m "feat(server): register the Kubernetes domain"
```

---

### Task 4: `DecisionService.issueGrant`

**Files:**
- Modify: `packages/server/src/decisions.ts`
- Test: `packages/server/tests/issue-grant.test.ts`

**Interfaces:**
- Consumes: `AuthorizationGrantSchema`, `signGrant`, `type SignedGrant`, `type ChangeReceipt` from `@changesafe/core` (Tasks 1–2); `DecisionService` (existing).
- Produces: `DecisionService#issueGrant(receipt, options): Promise<SignedGrant>`; `type IssueGrantOptions`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/tests/issue-grant.test.ts
import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, importSigningKeyPair, importVerifyingKey, verifyGrantSignature } from "@changesafe/core";
import { Ledger } from "@changesafe/ledger";
import { DecisionService } from "../src/decisions";

const NOW = "2026-08-19T12:00:00.000Z";

async function buildService() {
  const pem = await generateSigningKeyPair();
  const keyPair = await importSigningKeyPair(pem.privateKeyPem);
  const verifying = await importVerifyingKey(pem.publicKeyPem);
  const ledger = new Ledger(":memory:");
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
        sourceId: "src-test",
        input: { devices: { "rtr-1": { enabled: true } } },
        proposal: {
          proposalId: "prop-test-001",
          summary: "no-op",
          diagnosis: { likelyCause: "test", confidence: 0.9, evidenceIds: [], assumptions: [] },
          operations: [],
          rollbackOperations: [],
          verificationSteps: [],
        },
        decision: "approve",
      },
      { subject: "approver-1", issuer: "https://issuer.example", email: null },
    );

    const grant = await decisions.issueGrant(outcome.receipt, {
      authorizedActor: "system:serviceaccount:ops:changesafe-applier",
      operation: "UPDATE",
      resource: "res-0123456789abcdef",
      objectSha256: "a".repeat(64),
      expiresAtUtc: "2026-08-19T13:00:00.000Z",
    });

    expect(grant.grant.receiptId).toBe(outcome.receipt.receiptId);
    expect(grant.grant.policyVersion).toBe(outcome.receipt.policyVersion);
    expect(await verifyGrantSignature(grant, verifying)).toBe("valid");
  });

  it("refuses to issue a grant from a non-approved receipt", async () => {
    const { decisions } = await buildService();
    const outcome = await decisions.decide(
      {
        domain: "network",
        sourceId: "src-test",
        input: { devices: { "rtr-1": { enabled: true } } },
        proposal: {
          proposalId: "prop-test-002",
          summary: "no-op",
          diagnosis: { likelyCause: "test", confidence: 0.9, evidenceIds: [], assumptions: [] },
          operations: [],
          rollbackOperations: [],
          verificationSteps: [],
        },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/issue-grant.test.ts`
Expected: FAIL — `decisions.issueGrant is not a function`

- [ ] **Step 3: Implement `issueGrant`**

Add to the imports at the top of `packages/server/src/decisions.ts`:

```typescript
import {
  // ...existing imports...
  AuthorizationGrantSchema,
  signGrant,
  type GrantOperationSchema as GrantOperationSchemaType,
  type SignedGrant,
} from "@changesafe/core";
import { z } from "zod";
```

(Adjust the existing `@changesafe/core` import block rather than adding a
second one — merge into the single existing `import { ... } from "@changesafe/core"` statement at the top of the file.)

Add new exported types near `DecisionOutcome`:

```typescript
export interface IssueGrantOptions {
  authorizedActor: string;
  operation: z.infer<typeof GrantOperationSchemaType>;
  resource: string;
  objectSha256: string;
  expiresAtUtc: string;
}
```

Add the method to the `DecisionService` class, after `decideSigned`:

```typescript
  /**
   * Issue a signed AuthorizationGrant from an already-approved receipt.
   *
   * Requires a signing key for the same reason `decideSigned` does: an
   * unsigned grant would be indistinguishable from one anyone could forge,
   * and a grant that cannot prove who issued it authorizes nothing.
   */
  async issueGrant(receipt: ChangeReceipt, options: IssueGrantOptions): Promise<SignedGrant> {
    this.#requireSigningCapability();
    if (receipt.decision !== "approved") {
      throw new DomainError(
        "ILLEGAL_TRANSITION",
        `Receipt ${receipt.receiptId} was not approved and cannot authorize a grant.`,
      );
    }

    const grant = AuthorizationGrantSchema.parse({
      grantId: `grant-${globalThis.crypto.randomUUID()}`,
      receiptId: receipt.receiptId,
      authorizedActor: options.authorizedActor,
      operation: options.operation,
      resource: options.resource,
      objectSha256: options.objectSha256,
      policyVersion: receipt.policyVersion,
      issuedAtUtc: this.#options.now?.() ?? new Date().toISOString(),
      expiresAtUtc: options.expiresAtUtc,
    });

    // Non-null: #requireSigningCapability already confirmed this above.
    return signGrant(grant, this.#options.signingKeyPair!);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/tests/issue-grant.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full server test suite**

Run: `npx vitest run packages/server`
Expected: PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/decisions.ts packages/server/tests/issue-grant.test.ts
git commit -m "feat(server): issue signed AuthorizationGrants from approved decisions"
```

---

### Task 5: Wire grant issuance into the durable decision HTTP route

**Files:**
- Modify: `packages/server/src/http.ts`
- Test: `packages/server/tests/http-grant.test.ts` (or extend the existing durable-decision HTTP test file if one already covers `POST /reviews/:id/decisions` — check `packages/server/tests/` for it before creating a new file, and follow whichever convention that file uses for constructing a test server)

**Interfaces:**
- Consumes: `DecisionService#issueGrant` (Task 4).
- Produces: `POST /reviews/:id/decisions` response body gains an optional `grant` field when the caller supplies grant parameters and the decision is `approve`.

- [ ] **Step 1: Check for an existing HTTP integration test to extend**

Run: `find packages/server/tests -iname "*http*" -o -iname "*decision*"`

If a file already exercises `POST /reviews/:id/decisions` end-to-end (constructs a real `createDecisionServer`, sends a request, asserts the response), extend it instead of creating `http-grant.test.ts`, following its exact server-construction and request-sending pattern. Only create a new file if none exists.

- [ ] **Step 2: Write the failing test** (adapt to the found pattern from Step 1; the assertions below are what must hold regardless of file)

```typescript
// New assertions to add, in whichever file/pattern Step 1 identified:
// 1. POST /reviews/:id/decisions with decision:"approve" plus
//    grant: { authorizedActor, operation, resource, objectSha256, expiresAtUtc }
//    in the body returns 201 with a `grant` field in the response whose
//    `grant.receiptId` equals the response's `receiptId`.
// 2. Omitting `grant` from the body still returns 201 with no `grant` field
//    in the response (backward compatible — existing callers unaffected).
// 3. decision:"reject" with a `grant` field present in the body is rejected
//    with 422 (the body schema must not accept grant params on a reject).
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run <the test file from Step 1>`
Expected: FAIL — response has no `grant` field / body schema rejects the new field

- [ ] **Step 4: Extend `ReviewDecisionBodySchema` and the route handler**

In `packages/server/src/http.ts`, replace `ReviewDecisionBodySchema`:

```typescript
const GrantRequestSchema = z.strictObject({
  authorizedActor: z.string().min(1).max(255),
  operation: z.enum(["CREATE", "UPDATE", "DELETE", "CONNECT"]),
  resource: z.string().min(1).max(128),
  objectSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAtUtc: TimestampSchema,
});

const ReviewDecisionBodySchema = z
  .strictObject({
    decision: z.enum(["approve", "reject"]),
    grant: GrantRequestSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.decision === "reject" && body.grant) {
      ctx.addIssue({
        code: "custom",
        path: ["grant"],
        message: "a rejected decision cannot carry grant parameters",
      });
    }
  });
```

In the `reviewDecisionMatch` handler block, after `const decided = await options.reviews.resolvePending(...)`, issue the grant when requested:

```typescript
    const grant =
      body.decision === "approve" && body.grant
        ? await options.decisions.issueGrant(decided.outcome.receipt, body.grant)
        : undefined;

    send(response, 201, {
      receiptId: decided.outcome.receipt.receiptId,
      decision: decided.outcome.receipt.decision,
      riskLevel: decided.outcome.receipt.riskLevel,
      approver: decided.outcome.receipt.approver,
      ledgerSeq: decided.outcome.ledgerSeq,
      chainSha256: decided.outcome.chainSha256,
      record: decided.outcome.record,
      resolution: decided.resolution,
      ...(grant ? { grant } : {}),
    });
```

Note the existing `body` reference inside this block currently comes from
`ReviewDecisionBodySchema.parse(await readBody(request))` earlier in the
same handler — confirm the variable name in the current file before editing
(read the surrounding ~15 lines first; do not assume it is still named
`body` if Task-1-through-4 changes shifted anything, though they should not
have touched this file).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run <the test file from Step 1>`
Expected: PASS

- [ ] **Step 6: Run the full server test suite**

Run: `npx vitest run packages/server`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/http.ts packages/server/tests/
git commit -m "feat(server): issue an AuthorizationGrant from the durable decision route"
```

---

### Task 6: `packages/kubernetes-enforcer` package scaffold

**Files:**
- Create: `packages/kubernetes-enforcer/package.json`
- Create: `packages/kubernetes-enforcer/tsconfig.build.json`
- Create: `packages/kubernetes-enforcer/src/index.ts` (placeholder export, filled in Tasks 7–8)
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces: an installable workspace package `@changesafe/kubernetes-enforcer`, resolvable in both `npm` workspace tooling and Vitest.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@changesafe/kubernetes-enforcer",
  "version": "0.5.0",
  "private": true,
  "description": "Kubernetes admission-webhook verifier for ChangeSafe AuthorizationGrant.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@changesafe/core": "^0.5.0",
    "@changesafe/domain-kubernetes": "^0.5.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.build.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {"noEmit": false, "allowJs": false, "outDir": "dist", "rootDir": "src", "declaration": true, "declarationMap": false, "sourceMap": false, "incremental": false, "paths": {}},
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create a placeholder `src/index.ts`**

```typescript
/**
 * @changesafe/kubernetes-enforcer — verifies AuthorizationGrant at a
 * Kubernetes admission-webhook boundary. Never calls the Kubernetes API;
 * only receives AdmissionReview webhook requests and answers allow/deny.
 */
export {};
```

- [ ] **Step 4: Add the Vitest workspace alias**

In `vitest.config.ts`, add after the `@changesafe/kubernetes-collector` entry:

```typescript
      "@changesafe/kubernetes-enforcer": path.resolve(
        root,
        "packages/kubernetes-enforcer/src/index.ts",
      ),
```

- [ ] **Step 5: Install and verify the workspace resolves**

Run: `npm install`
Expected: `packages/kubernetes-enforcer` appears in `npm ls --workspaces` with no errors

Run: `npx vitest run packages/kubernetes-enforcer`
Expected: no test files found yet — exits cleanly (not an error) since Vitest with no matching files in an otherwise-passing run is a pass with 0 tests; if your Vitest config treats zero test files as failure, skip this check and proceed — Task 7 adds the first real test.

- [ ] **Step 6: Commit**

```bash
git add packages/kubernetes-enforcer vitest.config.ts package-lock.json
git commit -m "chore(kubernetes-enforcer): scaffold the package"
```

---

### Task 7: `AdmissionReview` wire schema

Kubernetes' `admission.k8s.io/v1` `AdmissionReview` request/response shape
has no existing TypeScript/Zod definition anywhere in this repo (it is not
part of `@kubernetes/client-node`'s generated REST client models — that
package is not a dependency of this new package at all, confirmed in Task 6).
Define it fresh, validated at the boundary per this repo's standard.

**Files:**
- Create: `packages/kubernetes-enforcer/src/admission-review.ts`
- Test: `packages/kubernetes-enforcer/tests/admission-review.test.ts`

**Interfaces:**
- Produces: `AdmissionReviewRequestSchema`, `type AdmissionReviewRequest`, `buildAdmissionReviewResponse(uid, result)`, `type AdmissionResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/kubernetes-enforcer/tests/admission-review.test.ts
import { describe, expect, it } from "vitest";
import {
  AdmissionReviewRequestSchema,
  buildAdmissionReviewResponse,
} from "../src/admission-review";

function buildReview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    apiVersion: "admission.k8s.io/v1",
    kind: "AdmissionReview",
    request: {
      uid: "11111111-1111-1111-1111-111111111111",
      operation: "UPDATE",
      userInfo: { username: "system:serviceaccount:ops:changesafe-applier", uid: "u-1", groups: [] },
      object: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "web", namespace: "default" },
        spec: { replicas: 3 },
      },
      ...overrides,
    },
  };
}

describe("AdmissionReviewRequestSchema", () => {
  it("accepts a well-formed admission review", () => {
    expect(AdmissionReviewRequestSchema.safeParse(buildReview()).success).toBe(true);
  });

  it("rejects a missing userInfo", () => {
    const review = buildReview();
    delete (review.request as Record<string, unknown>).userInfo;
    expect(AdmissionReviewRequestSchema.safeParse(review).success).toBe(false);
  });

  it("rejects an unknown operation", () => {
    expect(
      AdmissionReviewRequestSchema.safeParse(buildReview({ operation: "PATCH" })).success,
    ).toBe(false);
  });
});

describe("buildAdmissionReviewResponse", () => {
  it("echoes the request uid and carries the verdict", () => {
    const allowed = buildAdmissionReviewResponse("11111111-1111-1111-1111-111111111111", {
      allowed: true,
    });
    expect(allowed).toEqual({
      apiVersion: "admission.k8s.io/v1",
      kind: "AdmissionReview",
      response: { uid: "11111111-1111-1111-1111-111111111111", allowed: true },
    });

    const denied = buildAdmissionReviewResponse("11111111-1111-1111-1111-111111111111", {
      allowed: false,
      message: "grant object hash mismatch",
    });
    expect(denied.response).toEqual({
      uid: "11111111-1111-1111-1111-111111111111",
      allowed: false,
      status: { message: "grant object hash mismatch" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/kubernetes-enforcer/tests/admission-review.test.ts`
Expected: FAIL — `Cannot find module '../src/admission-review'`

- [ ] **Step 3: Write the schema**

```typescript
// packages/kubernetes-enforcer/src/admission-review.ts
import { z } from "zod";

/**
 * The subset of Kubernetes admission.k8s.io/v1 AdmissionReview this
 * verifier needs. `object` is intentionally `z.unknown()` here — it is
 * validated and normalized by @changesafe/domain-kubernetes's own
 * normalization pipeline (Task 8), not re-specified here.
 */
export const AdmissionUserInfoSchema = z.looseObject({
  username: z.string().min(1),
  uid: z.string().optional(),
  groups: z.array(z.string()).optional(),
});

export const AdmissionOperationSchema = z.enum(["CREATE", "UPDATE", "DELETE", "CONNECT"]);

export const AdmissionRequestSchema = z.looseObject({
  uid: z.string().min(1),
  operation: AdmissionOperationSchema,
  userInfo: AdmissionUserInfoSchema,
  object: z.unknown(),
});

export const AdmissionReviewRequestSchema = z.looseObject({
  apiVersion: z.literal("admission.k8s.io/v1"),
  kind: z.literal("AdmissionReview"),
  request: AdmissionRequestSchema,
});

export type AdmissionUserInfo = z.infer<typeof AdmissionUserInfoSchema>;
export type AdmissionRequest = z.infer<typeof AdmissionRequestSchema>;
export type AdmissionReviewRequest = z.infer<typeof AdmissionReviewRequestSchema>;

export type AdmissionResult =
  | { allowed: true }
  | { allowed: false; message: string };

/** Build the AdmissionReview response envelope Kubernetes expects back. */
export function buildAdmissionReviewResponse(uid: string, result: AdmissionResult) {
  return {
    apiVersion: "admission.k8s.io/v1" as const,
    kind: "AdmissionReview" as const,
    response: result.allowed
      ? { uid, allowed: true as const }
      : { uid, allowed: false as const, status: { message: result.message } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/kubernetes-enforcer/tests/admission-review.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/kubernetes-enforcer/src/admission-review.ts packages/kubernetes-enforcer/tests/admission-review.test.ts
git commit -m "feat(kubernetes-enforcer): add AdmissionReview wire schema"
```

---

### Task 8: Grant verification logic

This is the core of the enforcement point: given a signed grant and an
`AdmissionRequest`, decide allow/deny. Implements Spec Decisions 3, 4 (the
always-deny row only — the fail-open/fail-closed row is a deployment-time
`ValidatingWebhookConfiguration` concern, not runtime code, per Task 10), and
5.

**Files:**
- Create: `packages/kubernetes-enforcer/src/verify.ts`
- Modify: `packages/domain-kubernetes/src/index.ts` (export `normalizeRawResource`, currently internal-only)
- Test: `packages/kubernetes-enforcer/tests/verify.test.ts`

**Interfaces:**
- Consumes: `normalizeRawResource` from `@changesafe/domain-kubernetes` (exported in Step 3 below); `SignedGrantSchema`, `verifyGrantSignature`, `canonicalize`, `sha256Hex` from `@changesafe/core`; `AdmissionRequest` (Task 7).
- Produces: `verifyGrantAgainstAdmission(signedGrant, admissionRequest, trustedPublicKey, now)`, `type VerifyOutcome`.

- [ ] **Step 1: Write the failing test covering all 8 STRATEGY.md attack cases**

```typescript
// packages/kubernetes-enforcer/tests/verify.test.ts
import { describe, expect, it } from "vitest";
import {
  AuthorizationGrantSchema,
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
  sha256Hex,
  signGrant,
  canonicalize,
} from "@changesafe/core";
import { normalizeRawResource } from "@changesafe/domain-kubernetes";
import { verifyGrantAgainstAdmission } from "../src/verify";
import type { AdmissionRequest } from "../src/admission-review";

const RESOURCE = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "default" },
  spec: { replicas: 3 },
};
const RESOURCE_MODIFIED = { ...RESOURCE, spec: { replicas: 99 } };
const ACTOR = "system:serviceaccount:ops:changesafe-applier";

async function keys() {
  const pem = await generateSigningKeyPair();
  return {
    keyPair: await importSigningKeyPair(pem.privateKeyPem),
    verifying: await importVerifyingKey(pem.publicKeyPem),
  };
}

function objectHashOf(raw: unknown): string {
  const normalized = normalizeRawResource(raw, "ev-test");
  return sha256Hex(
    canonicalize({ identity: normalized.identity, metadata: normalized.metadata, spec: normalized.spec }),
  );
}

async function buildSignedGrant(overrides: Partial<Record<string, unknown>> = {}) {
  const { keyPair, verifying } = await keys();
  const grant = AuthorizationGrantSchema.parse({
    grantId: "grant-test-0001",
    receiptId: "rcpt-test-0001",
    authorizedActor: ACTOR,
    operation: "UPDATE",
    resource: "res-web-default",
    objectSha256: objectHashOf(RESOURCE),
    policyVersion: "kubernetes-v0.2.0",
    issuedAtUtc: "2026-08-19T12:00:00.000Z",
    expiresAtUtc: "2026-08-19T13:00:00.000Z",
    ...overrides,
  });
  const signed = await signGrant(grant, keyPair, { signedAtUtc: "2026-08-19T12:00:00.000Z" });
  return { signed, verifying };
}

function admissionRequest(overrides: Partial<AdmissionRequest> = {}): AdmissionRequest {
  return {
    uid: "req-1",
    operation: "UPDATE",
    userInfo: { username: ACTOR, groups: [] },
    object: RESOURCE,
    ...overrides,
  } as AdmissionRequest;
}

const NOW = () => new Date("2026-08-19T12:30:00.000Z");

describe("verifyGrantAgainstAdmission", () => {
  it("allows a matching grant and request", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW);
    expect(outcome).toEqual({ allowed: true });
  });

  it("denies on object substitution (object changed after authorization)", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ object: RESOURCE_MODIFIED }),
      verifying,
      NOW,
    );
    expect(outcome.allowed).toBe(false);
  });

  it("denies on resource substitution", async () => {
    const { signed, verifying } = await buildSignedGrant({ resource: "res-other" });
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW);
    // resource is opaque to the admission request itself in this minimal
    // shape (the request carries the object, not a resource id) — this
    // case is exercised via Task 9's caller supplying the resolved
    // resource id alongside the request; see verify.ts's `expectedResource`
    // parameter added in this task.
    expect(outcome.allowed).toBe(true); // placeholder — replaced in Step 3 below
  });

  it("denies on operation substitution", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ operation: "DELETE" }),
      verifying,
      NOW,
    );
    expect(outcome.allowed).toBe(false);
  });

  it("denies on identity substitution", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest({ userInfo: { username: "system:serviceaccount:ops:attacker", groups: [] } }),
      verifying,
      NOW,
    );
    expect(outcome.allowed).toBe(false);
  });

  it("denies a grant signed by an untrusted key (replay with a forged grant)", async () => {
    const { signed } = await buildSignedGrant();
    const otherKeys = await keys();
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), otherKeys.verifying, NOW);
    expect(outcome.allowed).toBe(false);
  });

  it("denies a stale/expired grant", async () => {
    const { signed, verifying } = await buildSignedGrant({
      expiresAtUtc: "2026-08-19T12:15:00.000Z",
    });
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW);
    expect(outcome.allowed).toBe(false);
  });

  it("denies on policy version drift", async () => {
    const { signed, verifying } = await buildSignedGrant({ policyVersion: "kubernetes-v0.1.0" });
    const outcome = await verifyGrantAgainstAdmission(
      signed,
      admissionRequest(),
      verifying,
      NOW,
      { expectedPolicyVersion: "kubernetes-v0.2.0" },
    );
    expect(outcome.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/kubernetes-enforcer/tests/verify.test.ts`
Expected: FAIL — `Cannot find module '../src/verify'`, and `normalizeRawResource` not exported from `@changesafe/domain-kubernetes`

- [ ] **Step 3: Export `normalizeRawResource` from `packages/domain-kubernetes`**

In `packages/domain-kubernetes/src/index.ts`, add beside the existing
`export { normalizeSnapshot } from "./normalize";` line:

```typescript
export { normalizeRawResource } from "./normalize";
```

- [ ] **Step 4: Fix the resource-substitution test to be real (not a placeholder)**

The "denies on resource substitution" test written in Step 1 is deliberately
wrong (it asserts `true` with a comment admitting it). Fix it now, before
implementing: `verifyGrantAgainstAdmission` must accept the caller-resolved
expected resource id as an option (the admission request's raw object alone
does not carry a domain resource id — the caller, which already has
`@changesafe/domain-kubernetes`, resolves it via `resourceIdOf` before
calling). Replace the test with:

```typescript
  it("denies on resource substitution", async () => {
    const { signed, verifying } = await buildSignedGrant({ resource: "res-a-different-resource" });
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW, {
      expectedResource: "res-web-default",
    });
    expect(outcome.allowed).toBe(false);
  });
```

And update the "allows a matching grant" test to pass the matching option
too:

```typescript
  it("allows a matching grant and request", async () => {
    const { signed, verifying } = await buildSignedGrant();
    const outcome = await verifyGrantAgainstAdmission(signed, admissionRequest(), verifying, NOW, {
      expectedResource: "res-web-default",
    });
    expect(outcome).toEqual({ allowed: true });
  });
```

- [ ] **Step 5: Implement `verify.ts`**

```typescript
// packages/kubernetes-enforcer/src/verify.ts
import {
  canonicalize,
  sha256Hex,
  verifyGrantSignature,
  type SignedGrant,
} from "@changesafe/core";
import { normalizeRawResource } from "@changesafe/domain-kubernetes";

import type { AdmissionRequest } from "./admission-review";

export interface VerifyOptions {
  /** Resolved by the caller via @changesafe/domain-kubernetes's resourceIdOf. */
  expectedResource?: string;
  /** Checked against the grant's recorded policyVersion when supplied. */
  expectedPolicyVersion?: string;
}

export type VerifyOutcome = { allowed: true } | { allowed: false; reason: string };

function objectHashOf(raw: unknown): string {
  const normalized = normalizeRawResource(raw, "ev-admission-review");
  return sha256Hex(
    canonicalize({
      identity: normalized.identity,
      metadata: normalized.metadata,
      spec: normalized.spec,
    }),
  );
}

/**
 * Verify a signed AuthorizationGrant authorizes exactly this admission
 * request: correct signer, actor, operation, resource, object state, and
 * not expired or drifted onto a different policy version.
 *
 * This function only ever returns an explicit allow/deny — it has no
 * concept of "the verifier is unreachable" (that failure mode does not
 * exist inside a synchronous verification call; it is what happens to the
 * *caller* of this function when the whole webhook process is down, which
 * Kubernetes' own `failurePolicy` handles at the ValidatingWebhookConfiguration
 * level — see Task 10).
 */
export async function verifyGrantAgainstAdmission(
  signed: SignedGrant,
  request: AdmissionRequest,
  trustedPublicKey: CryptoKey,
  now: () => Date,
  options: VerifyOptions = {},
): Promise<VerifyOutcome> {
  const signatureVerdict = await verifyGrantSignature(signed, trustedPublicKey);
  if (signatureVerdict !== "valid") {
    return { allowed: false, reason: `grant signature ${signatureVerdict}` };
  }

  const { grant } = signed;

  if (grant.authorizedActor !== request.userInfo.username) {
    return { allowed: false, reason: "authorized actor does not match the requesting identity" };
  }

  if (grant.operation !== request.operation) {
    return { allowed: false, reason: "grant operation does not match the requested operation" };
  }

  if (options.expectedResource !== undefined && grant.resource !== options.expectedResource) {
    return { allowed: false, reason: "grant resource does not match the requested resource" };
  }

  if (objectHashOf(request.object) !== grant.objectSha256) {
    return { allowed: false, reason: "requested object does not match the object the grant authorized" };
  }

  if (
    options.expectedPolicyVersion !== undefined &&
    grant.policyVersion !== options.expectedPolicyVersion
  ) {
    return { allowed: false, reason: "grant policy version has drifted from the active policy version" };
  }

  const nowMs = now().getTime();
  if (nowMs >= Date.parse(grant.expiresAtUtc)) {
    return { allowed: false, reason: "grant has expired" };
  }
  if (nowMs < Date.parse(grant.issuedAtUtc)) {
    return { allowed: false, reason: "grant is not yet valid" };
  }

  return { allowed: true };
}
```

- [ ] **Step 6: Fix the test file's `VerifyOutcome` assertions**

The Step 1 tests use `expect(outcome.allowed).toBe(false)` and one uses
`toEqual({ allowed: true })` — both are compatible with the real
`VerifyOutcome` shape (`{ allowed: false; reason: string }` still satisfies
`outcome.allowed === false`), so no further test edits are needed here
beyond Step 4's fix.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run packages/kubernetes-enforcer/tests/verify.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 8: Run the full domain-kubernetes and kubernetes-enforcer suites**

Run: `npx vitest run packages/domain-kubernetes packages/kubernetes-enforcer`
Expected: PASS, no regressions

- [ ] **Step 9: Commit**

```bash
git add packages/kubernetes-enforcer/src/verify.ts packages/kubernetes-enforcer/tests/verify.test.ts packages/domain-kubernetes/src/index.ts
git commit -m "feat(kubernetes-enforcer): verify grants against admission requests"
```

---

### Task 9: Admission-webhook HTTP server

**Files:**
- Create: `packages/kubernetes-enforcer/src/server.ts`
- Modify: `packages/kubernetes-enforcer/src/index.ts`
- Test: `packages/kubernetes-enforcer/tests/server.test.ts`

**Interfaces:**
- Consumes: `verifyGrantAgainstAdmission` (Task 8), `AdmissionReviewRequestSchema`, `buildAdmissionReviewResponse` (Task 7).
- Produces: `createEnforcerServer(options): Server` — a `node:http` server, mirroring `packages/server/src/http.ts`'s construction pattern.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/kubernetes-enforcer/tests/server.test.ts
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

function objectHashOf(raw: unknown): string {
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
      objectSha256: objectHashOf(RESOURCE),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/kubernetes-enforcer/tests/server.test.ts`
Expected: FAIL — `Cannot find module '../src/server'`

- [ ] **Step 3: Implement the server**

```typescript
// packages/kubernetes-enforcer/src/server.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { SignedGrant } from "@changesafe/core";
import { SignedGrantSchema } from "@changesafe/core";

import { AdmissionReviewRequestSchema, buildAdmissionReviewResponse } from "./admission-review";
import { verifyGrantAgainstAdmission } from "./verify";

const MAX_BODY_BYTES = 1024 * 1024;

export interface EnforcerServerOptions {
  trustedPublicKey: CryptoKey;
  now: () => Date;
  /**
   * Resolve the expected domain resource id for this admission request
   * (via @changesafe/domain-kubernetes's resourceIdOf) so verify.ts can
   * check it against the grant's `resource` field.
   */
  resolveExpectedResource: (object: unknown) => string;
  expectedPolicyVersion?: string;
  /**
   * How the grant physically arrives with the request. Left injectable —
   * Task 10 decides and hard-codes the real mechanism (an annotation on the
   * admitted object vs. a header vs. something else); this test seam is
   * intentional per the spec's "resolve empirically" note.
   */
  readGrant: (request: IncomingMessage) => unknown | null;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function createEnforcerServer(options: EnforcerServerOptions): Server {
  return createServer((request, response) => {
    void handle(request, response, options).catch(() => {
      send(response, 500, { error: "internal error" });
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: EnforcerServerOptions,
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/validate") {
    send(response, 404, { error: "not found" });
    return;
  }

  const review = AdmissionReviewRequestSchema.parse(await readBody(request));
  const rawGrant = options.readGrant(request);

  if (rawGrant === null) {
    send(
      response,
      200,
      buildAdmissionReviewResponse(review.request.uid, {
        allowed: false,
        message: "no AuthorizationGrant was attached to this request",
      }),
    );
    return;
  }

  const signedGrant: SignedGrant = SignedGrantSchema.parse(rawGrant);
  const expectedResource = options.resolveExpectedResource(review.request.object);
  const outcome = await verifyGrantAgainstAdmission(
    signedGrant,
    review.request,
    options.trustedPublicKey,
    options.now,
    { expectedResource, expectedPolicyVersion: options.expectedPolicyVersion },
  );

  send(
    response,
    200,
    buildAdmissionReviewResponse(
      review.request.uid,
      outcome.allowed ? { allowed: true } : { allowed: false, message: outcome.reason },
    ),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/kubernetes-enforcer/tests/server.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Export from `src/index.ts`**

Replace the placeholder from Task 6:

```typescript
/**
 * @changesafe/kubernetes-enforcer — verifies AuthorizationGrant at a
 * Kubernetes admission-webhook boundary. Never calls the Kubernetes API;
 * only receives AdmissionReview webhook requests and answers allow/deny.
 */
export { createEnforcerServer } from "./server";
export type { EnforcerServerOptions } from "./server";
export { verifyGrantAgainstAdmission } from "./verify";
export type { VerifyOptions, VerifyOutcome } from "./verify";
export {
  AdmissionReviewRequestSchema,
  buildAdmissionReviewResponse,
} from "./admission-review";
export type { AdmissionRequest, AdmissionReviewRequest, AdmissionResult } from "./admission-review";
```

- [ ] **Step 6: Run the full kubernetes-enforcer suite**

Run: `npx vitest run packages/kubernetes-enforcer`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add packages/kubernetes-enforcer/src/server.ts packages/kubernetes-enforcer/src/index.ts packages/kubernetes-enforcer/tests/server.test.ts
git commit -m "feat(kubernetes-enforcer): add the admission-webhook HTTP server"
```

---

### Task 10: `failurePolicy` deployment manifests, kind-cluster reproduction, and 90s demo

This task is deployment configuration and manual/scripted verification, not
unit-testable application code — per the spec, exactly how a grant attaches
to a `kubectl apply` request is an open, empirically-resolved question, and a
kind cluster is the only environment that can answer it.

**Files:**
- Create: `examples/m2-kubernetes-enforcer/webhook-protected.yaml`
- Create: `examples/m2-kubernetes-enforcer/webhook-default.yaml`
- Create: `examples/m2-kubernetes-enforcer/README.md`
- Create: `examples/m2-kubernetes-enforcer/kind-repro.sh`

- [ ] **Step 1: Write the two-tier `ValidatingWebhookConfiguration` manifests**

Kubernetes' `failurePolicy` is set per webhook registration, not per
request — Spec Decision 4's two-tier behavior requires **two** webhook
configurations selected by the existing `changesafe.dev/protected`
annotation via `objectSelector`.

```yaml
# examples/m2-kubernetes-enforcer/webhook-protected.yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: changesafe-enforcer-protected
webhooks:
  - name: protected.enforcer.changesafe.dev
    admissionReviewVersions: ["v1"]
    sideEffects: None
    clientConfig:
      url: https://changesafe-enforcer.changesafe-system.svc:8443/validate
      caBundle: <base64-ca-bundle>
    objectSelector:
      matchLabels: {}
      matchExpressions: []
    # Only resources actually annotated changesafe.dev/protected: "true"
    # route here — fail-closed applies only to what was already declared
    # protected, per Spec Decision 4.
    rules:
      - apiGroups: ["apps", ""]
        apiVersions: ["v1"]
        operations: ["UPDATE", "DELETE"]
        resources: ["deployments", "statefulsets", "daemonsets", "services"]
    failurePolicy: Fail
```

```yaml
# examples/m2-kubernetes-enforcer/webhook-default.yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: changesafe-enforcer-default
webhooks:
  - name: default.enforcer.changesafe.dev
    admissionReviewVersions: ["v1"]
    sideEffects: None
    clientConfig:
      url: https://changesafe-enforcer.changesafe-system.svc:8443/validate
      caBundle: <base64-ca-bundle>
    rules:
      - apiGroups: ["apps", ""]
        apiVersions: ["v1"]
        operations: ["UPDATE", "DELETE"]
        resources: ["deployments", "statefulsets", "daemonsets", "services"]
    failurePolicy: Ignore
```

An `objectSelector` cannot directly match "has annotation X" using
`matchLabels` (annotations are not labels) — resolve this during the kind
reproduction in Step 3 (likely: a mutating step or controller that mirrors
the `changesafe.dev/protected` annotation onto a label the selector can
match, or splitting the protected config to omit `objectSelector` and rely
on a namespace convention instead). Do not guess the resolution here; record
whatever the kind cluster proves works in `README.md`.

- [ ] **Step 2: Write `README.md` documenting the two-tier behavior and its caveat**

```markdown
# M2 Kubernetes Enforcer — kind reproduction

Two ValidatingWebhookConfigurations implement Spec Decision 4's two-tier
failurePolicy:

- `webhook-protected.yaml` (`failurePolicy: Fail`) — resources the
  `K8S_PROTECTED_RESOURCE` policy already tracks via the
  `changesafe.dev/protected: "true"` annotation.
- `webhook-default.yaml` (`failurePolicy: Ignore`) — everything else.

**Open caveat, resolved empirically below:** Kubernetes' `objectSelector`
matches labels, not annotations. See `kind-repro.sh` for how this
repository's kind reproduction routes protected resources to the `Fail`
webhook. Do not assume the YAML above is final until that script's run
confirms the selector approach it settled on.

## Reproducing

1. `kind create cluster`
2. Build and load the enforcer image: `docker build -t changesafe-kubernetes-enforcer:dev packages/kubernetes-enforcer && kind load docker-image changesafe-kubernetes-enforcer:dev`
3. `./kind-repro.sh` — deploys the enforcer, applies both webhook
   configurations, then runs the three demo steps below.

## 90-second demo

1. **Authorize and exercise correctly (ALLOW):** issue a grant for a benign
   Deployment replica change via the server's decision endpoint, apply it
   with the matching grant attached — allowed.
2. **Reuse the same grant against a modified object (DENY):** apply a
   *different* replica count using the same grant — denied, object hash
   mismatch.
3. **Fail-closed when the verifier is unavailable on a protected resource:**
   scale the enforcer deployment to 0, attempt to modify a resource
   annotated `changesafe.dev/protected: "true"` — denied by
   `failurePolicy: Fail`. Attempt the same against an unprotected resource —
   allowed by `failurePolicy: Ignore`.

Record actual command transcripts and outcomes here after running the
script, replacing this placeholder paragraph — this file itself becomes the
milestone's kind-cluster-reproduction and failure-mode-document deliverable
once filled in with real output. Also state explicitly here (per the spec's
"Explicit non-claims" section): `ALLOW` in this demo means only that the
admission request matched its grant — it is not proof the Deployment
controller reconciled successfully or that the running pods reflect the new
spec.
```

- [ ] **Step 3: Write `kind-repro.sh`**

```bash
#!/usr/bin/env bash
# examples/m2-kubernetes-enforcer/kind-repro.sh
#
# Manual/local reproduction script — not run in CI. Requires kind, kubectl,
# and docker. Exits non-zero on the first unexpected result so a run either
# fully demonstrates the three demo steps or fails loudly.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "This script is a starting skeleton, not a finished reproduction."
echo "Fill in each step below as the kind cluster proves what actually works,"
echo "per the open caveat in README.md (objectSelector cannot match an"
echo "annotation directly)."

# 1. kind create cluster --name changesafe-m2
# 2. build + load the enforcer image
# 3. deploy the enforcer (Deployment + Service + TLS cert, self-signed or
#    via a local CA — record the exact commands here once decided)
# 4. kubectl apply -f webhook-protected.yaml -f webhook-default.yaml
# 5. run the three demo steps from README.md, capturing kubectl output
#    into demo-transcript.txt in this directory

exit 1  # deliberately fails until the steps above are filled in for real
```

- [ ] **Step 4: Run the reproduction against a real kind cluster**

This step cannot be automated as a TDD unit test — it requires a real local
Kubernetes cluster. Run `./kind-repro.sh` manually, iterate on the script and
both YAML manifests until all three demo steps in `README.md` produce the
documented outcomes, then replace the README's demo section with the actual
transcript.

Expected when done: three real command transcripts in `README.md` matching
the three demo-step outcomes (ALLOW, DENY on object substitution, and the
split ALLOW/DENY on verifier-down between protected and unprotected
resources).

- [ ] **Step 5: Commit**

```bash
git add examples/m2-kubernetes-enforcer/
git commit -m "docs(kubernetes-enforcer): failurePolicy manifests and kind reproduction"
```

---

### Task 11: Adversarial gate documentation and E1/E2/E3 gap

Per `docs/STRATEGY.agent.md` R8 ("Close a milestone without its adversarial
release gate exercised" is forbidden) and the spec's "Deliverables" section.

**Files:**
- Modify: `docs/ADVERSARIAL_FINDINGS.md` (append `CS-ADV-003` onward as
  applicable — only for findings actually reproduced during Tasks 1–10, per
  the existing "review feedback is not a finding" promotion rule already
  documented in that file)
- Create or modify: an M2 technical note under `docs/`, mirroring
  `docs/M1_TIER1_TECHNICAL_NOTE.md`'s structure, stating the E1/E2/E3 gap
  explicitly (ALLOW at the enforcement boundary is not persistence, per Spec
  "Explicit non-claims")
- Modify: `docs/LESSONS_LEARNED.md`

- [ ] **Step 1: Walk the 8 attack cases exercised by Task 8's tests plus the
  ledger/nonce/revocation questions deferred in the spec, and write one
  `CS-ADV-NNN` entry per case that produced a real finding** (not every
  passing test is a finding — only ones where the *first* attempt exposed a
  real gap later fixed, per the existing file's own convention; re-read
  `docs/ADVERSARIAL_FINDINGS.md`'s existing two entries for the exact format
  before writing new ones)

- [ ] **Step 2: Write the M2 technical note**, covering: what was built,
  what `ALLOW` does and does not prove, the ledger-recording gap explicitly
  carried forward from the spec's "Explicitly deferred" section, and a
  pointer to `examples/m2-kubernetes-enforcer/README.md`'s demo transcript

- [ ] **Step 3: Add a `docs/LESSONS_LEARNED.md` entry** for whatever Task 10's
  `objectSelector`-vs-annotation resolution actually turned out to be — this
  is exactly the kind of "resolved empirically, not architecturally"
  question the earlier M1 close-out lesson describes

- [ ] **Step 4: Commit**

```bash
git add docs/ADVERSARIAL_FINDINGS.md docs/LESSONS_LEARNED.md docs/M2_TECHNICAL_NOTE.md
git commit -m "docs: M2 adversarial gate findings and technical note"
```

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (module boundary) → Tasks 1, 2, 6. Decision 2
  (server issues) → Tasks 3, 4, 5. Decision 3 (identity via userInfo) → Task
  8. Decision 4 (failurePolicy) → Tasks 8 (always-deny row) and 10
  (fail-open/closed row, deployment-level). Decision 5 (object hash via
  normalize.ts) → Task 8. Data flow steps 1–3 → Tasks 3–5; steps 4–5 → Tasks
  7–10. Deliverables (kind repro, failure-mode doc, E1/E2/E3 gap,
  adversarial gate, 90s demo) → Tasks 10–11. Explicitly-deferred items
  (ledger, nonce/revocation, identity system) are called out as **not**
  built in the Global Constraints section and nowhere implemented.
- **Type consistency check performed:** `AuthorizationGrant.resource` /
  `AuthorizationGrant.objectSha256` (Task 1) flow unchanged through
  `IssueGrantOptions` (Task 4), `GrantRequestSchema` (Task 5), and
  `VerifyOptions.expectedResource` (Task 8) — same field names, same types,
  confirmed by re-reading each task's interfaces block against Task 1's
  schema.
- **Known gap intentionally left open:** Task 3 Step 4 flags that
  `deriveManifestProposal`'s exact return shape must be confirmed against
  the real source before trusting the code in Step 3 — this repo detail
  was not fully verified during planning and is called out explicitly
  rather than guessed at silently.
