# M2 Technical Note

M2 tests whether a ChangeSafe authorization can be bound to enforcement: can
an `AuthorizationGrant` be exercised only by the authorized actor, for the
exact operation, resource, and canonical object it was issued for? It does
not test ledger durability of grants, replay/nonce defenses beyond the base
shape, or a ChangeSafe-owned identity system — all explicitly deferred per
`docs/superpowers/specs/2026-08-19-m2-authorization-grant-design.md`.

## What was built

- `packages/core`: the `AuthorizationGrant` schema (grant id, source receipt
  id, authorized actor, operation, resource, object hash, policy version,
  issued-at, expires-at) and Ed25519 grant signing/verification
  (`signGrant`, `verifyGrantSignature`), reusing the same key-pair machinery
  as receipt signing.
- `packages/server`: grant issuance wired into the durable decision HTTP
  route, so an approved decision can produce a signed grant alongside its
  `ChangeReceipt`.
- `packages/kubernetes-enforcer` (new package): a `ValidatingWebhookConfiguration`-compatible
  admission-webhook HTTP server. It reads a `SignedGrant` from the
  `changesafe.dev/grant` annotation on the admitted object (the only
  physically viable attachment point — admission webhooks are called by the
  API server with the full object body, not by `kubectl`, so no
  out-of-band header mechanism was ever available), verifies the grant's
  signature and every binding (actor, operation, resource, object hash,
  policy version, expiry) against the live `AdmissionReview` request, and
  returns ALLOW or DENY.
- 8 unit-tested attack cases against `verifyGrantAgainstAdmission`: matching
  allow, object substitution, resource substitution, operation
  substitution, identity substitution, untrusted signer, expired grant, and
  policy version drift — the full attack list from `docs/STRATEGY.md`'s M2
  section.
- A real `kind`-cluster reproduction (`examples/m2-kubernetes-enforcer/`)
  proving all three demo steps against a live local Kubernetes API server,
  not a simulation: ALLOW on a correctly authorized change, DENY when the
  same grant is reused against a modified object, and the fail-open
  (`failurePolicy: Ignore`) vs. fail-closed (`failurePolicy: Fail`) split
  when the enforcer itself is unreachable, routed by a namespace-label
  convention rather than the per-object `objectSelector` Kubernetes does
  not support for annotations.

## What `ALLOW` does and does not prove — the E1/E2/E3 gap

Per `docs/STRATEGY.md`'s effect vocabulary:

| Stage | Meaning |
|---|---|
| **E0** | Authorized proposal — what ChangeSafe approved |
| **E1** | Admitted request — the object observed at the final validation boundary |
| **E2** | Persisted state — what the API server actually stored |
| **E3** | Realized effect — the actual system state after controllers reconcile |

M2 binds **E0 to E1**: the enforcer proves that the object the API server
is about to admit is the exact object, operation, resource, and actor a
signed grant authorized, at the moment the webhook fires. That is a real,
cryptographically verified boundary check — the kind reproduction's DENY
step demonstrates it rejecting a reused grant against a substituted object,
not just asserting it in a unit test.

`ALLOW` at this boundary is **not** a persistence attestation. It does not
mean:

- **E2 — the API server actually stored the object.** A validating webhook
  runs before etcd commit; a later admission stage, a conflicting resource
  version, or an API server-side failure can still prevent persistence even
  after this webhook returns ALLOW.
- **E3 — a controller reconciled the intended state.** The kind
  reproduction deliberately asserts only on `spec.replicas` as recorded by
  the API server (what the admission decision itself governs) and does not
  wait for or check Deployment rollout completion, pod readiness, or any
  downstream reconciliation.

The E1 → E2 → E3 gap is a documented open research question for this
project, not a scope item M2 was expected to close.

### The ledger-recording gap (deliberately deferred, not an oversight)

Grants issued in this pass are **not** written to `packages/ledger`. The
ledger remains receipt-only. This means a grant can currently be issued and
exercised with no durable, tamper-evident record that it was ever issued —
an audit gap. This was an explicit design decision
(`docs/superpowers/specs/2026-08-19-m2-authorization-grant-design.md`,
"Explicitly deferred"), not something missed: the M2 design spec treats
grants-in-the-ledger as a candidate future attack case, to be built only if
a real counterexample (not a hypothetical one) demonstrates the audit gap
matters in practice. The same document explicitly defers nonce/use-state/
revocation beyond the base signature-plus-expiry-plus-exact-binding shape,
and explicitly rejects (not merely defers) a ChangeSafe-owned identity or
claims system — grant identity is Kubernetes' own `AdmissionReview`
`userInfo`, nothing new was introduced.

## Demo transcript

The full 90-second demo — authorize and exercise correctly (ALLOW), reuse
the same authorization against a modified object (DENY), and fail-closed
vs. fail-open behavior when the verifier is unreachable — ran for real
against a live `kind` cluster in a single unattended run. The reproduction
script, webhook manifests, and the unedited transcript from that run are in
`examples/m2-kubernetes-enforcer/README.md` and
`examples/m2-kubernetes-enforcer/demo-transcript.txt`.
