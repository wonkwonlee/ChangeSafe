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
  expiry, and — when the operator configures an expected value — policy
  version) against the live `AdmissionReview` request, and
  returns ALLOW or DENY. Bad input is answered, not escalated: a malformed
  grant, an unreadable `AdmissionReview`, or a non-normalizable object all
  produce an explicit `allowed: false`, never a non-2xx reply that
  Kubernetes would route through `failurePolicy` (which on the default tier
  means admit). The unreachable-verifier case — the only one
  `failurePolicy` is meant for — stays with Kubernetes.

  The verifier registers `UPDATE` only. A `DELETE` `AdmissionReview` carries
  the resource in `oldObject` rather than `object`, which it does not yet
  read, so `DELETE` is left unregistered instead of producing verdicts with
  no object check behind them.
- A cross-package integration test
  (`tests/integration/m2-grant-issuance-to-enforcement.test.ts`) that drives
  a real server decision through `DecisionService#issueGrant` and hands the
  resulting `SignedGrant` to the enforcer's `verifyGrantAgainstAdmission`
  against a real `AdmissionReview` — ALLOW on the authorized object, DENY
  once it is mutated. Every other M2 test covers one half of that chain.
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
matters in practice. The same document deferred nonce/use-state/
revocation beyond the base signature-plus-expiry-plus-exact-binding shape
"until an attack case demonstrates replay the base shape cannot catch" —
and one did: a CREATE grant, having by definition no prior state or
resource uid to bind, could be exercised again after an out-of-band delete
(`CS-ADV-018`). The enforcer now honours each `grantId` at most once per
process (`packages/kubernetes-enforcer/src/use-state.ts`); a durable,
replica-shared use-state remains the deferred design item, and the
process-local scope is stated in that file rather than glossed. The spec
explicitly rejects (not merely defers) a ChangeSafe-owned identity or
claims system — grant identity is Kubernetes' own `AdmissionReview`
`userInfo`, nothing new was introduced.

### The issuance-binding gap: what a grant's fields actually prove

A grant carries `receiptId`, `policyVersion`, `operation`, `resource`, and
`objectSha256`. Only the first two are server-derived. **The
operation/resource/object binding is asserted by the caller at issuance
time and is not cross-checked against the approved proposal.**

`POST /reviews/:id/decisions` takes those three fields directly from the
request body (`GrantRequestSchema` in `packages/server/src/http.ts`) and
`DecisionService#issueGrant` copies them into the signed grant unchanged.
The receipt is recomputed server-side, the approval still cannot bypass a
BLOCK finding, and the grant is bound to the receipt it came from — but
nothing verifies that the resource named in the grant is the resource that
receipt approved a change to, or that `objectSha256` is the hash of the
object that change would produce. An authenticated approver can mint a
grant naming a resource from an entirely different domain, with an
arbitrary object hash, from a legitimately approved receipt. This is
reproduced in `packages/server/tests/reviews.test.ts` and recorded as
`CS-ADV-004` in `docs/ADVERSARIAL_FINDINGS.md`.

The design spec's data flow says these fields should be "derived from the
same evaluated proposal (never re-entered)". The implementation does not do
that, and closing the gap means per-domain extraction of a resource id and
a canonical object hash from a receipt's proposal — real work with a real
design, which is a future milestone, not a footnote to this one. Until then
the honest statement is the one above: **a grant proves that an approved
decision exists and which one it is; it does not prove that the object it
authorizes is the object that decision was about.** The enforcer's checks
are exactly as strong as the binding it was handed.

### The object hash: what it covers now, and what it covered before a fix

Even for the fields a grant DOES bind server-side-verified at admission
time, the object hash itself must actually capture the whole object.
`kubernetesObjectSha256` originally computed that hash over
`normalizeRawResource`'s output — a projection `packages/domain-kubernetes`
built for policy evaluation, which keeps only the fields today's five
policies read (a container's `name`, `image`, and a `securityContext`
subset; a Deployment's `replicas`/`strategy`; a Service's `type`/
`selector`) and silently discards everything else, including container
`command`, `args`, `env`, and `resources`, and Service `ports`. Two objects
differing only in one of those discarded fields hashed identically, so a
grant issued against one authorized admission of the other — recorded as
`CS-ADV-005` in `docs/ADVERSARIAL_FINDINGS.md` and found by external review
of this PR, not the internal adversarial-gate exercise.

The fix adds `canonicalizeAdmittedResource` alongside `normalizeRawResource`
in `packages/domain-kubernetes` — same envelope parsing and identity
derivation, but the full `spec` is kept rather than projected, and only
`metadata`'s server-owned/managed keys are excluded. `normalizeRawResource`
itself is untouched; policy evaluation still uses it, correctly, since
projecting to policy-relevant fields is the right thing for that consumer.
`kubernetesObjectSha256` now uses the new function. See `CS-ADV-005` for the
full before/after and the accepted tradeoff this introduces: the hash no
longer tolerates K8s server-side spec defaulting between gate time and
admission time, so a grant issued against a manifest that omits a
field the API server later defaults can produce a false DENY. That is the
intended direction to fail in.

### The durable HTTP review flow does not actually reach Kubernetes yet

`packages/server/src/domains.ts` registers a `kubernetes` `ServerDomain`
(Task 3 of the M2 plan), but that registry and the durable HTTP intake
boundary (`features/reviews/durable-review-contract.ts`'s
`DurableReviewDomainIdSchema = z.enum(["network", "terraform"])`) are two
separate sources of truth for "which domains this server supports," and
only the first was updated. **`POST /reviews` rejects a Kubernetes intake
at the schema boundary before `resolveServerDomain` is ever consulted, so
`POST /reviews/:id/decisions` — the only route that issues a grant — can
never receive a pending Kubernetes review to decide.** Every other piece
of Kubernetes support in M2 (the grant schema, signing, verification, the
admission-webhook enforcer) is real, tested, and reachable; only the
durable, authenticated HTTP path connecting a human approval to a grant is
not, for this domain, today. `tests/integration/
m2-grant-issuance-to-enforcement.test.ts` and `packages/server/tests/
domains-kubernetes.test.ts` both call `DecisionService`/`resolveServerDomain`
directly, which is exactly why neither test caught this — both bypass the
HTTP intake layer this gap lives in. Recorded as **`CS-ADV-013`** in
`docs/ADVERSARIAL_FINDINGS.md`. Closing it touches the durable review
contract's schemas, the SQLite persistence layer's own hardcoded
two-domain enum, and a real design question (Kubernetes' manifest-text
proposal shape matches neither network's nor terraform's existing model)
— real work, not fixed in this pass.

### The tier label itself is unprotected: the most severe open gap

The entire two-tier `failurePolicy` design routes on one signal — the
`changesafe.dev/tier: protected` namespace label — and neither webhook
configuration's `rules` names `namespaces` as a covered resource. **Anyone
with RBAC to edit a Namespace's labels (not workload RBAC) can remove or
change that label with no grant check, no signature, nothing, silently
downgrading every workload in that namespace from fail-closed to
fail-open for all future changes.** Unlike every other gap in this
document, exploiting this needs no interaction with the grant system at
all — the routing signal is plain metadata the enforcer never receives an
admission request for. Recorded as `CS-ADV-006`'s sibling, `CS-ADV-007`'s
sibling in severity, and specifically as **`CS-ADV-009`** in
`docs/ADVERSARIAL_FINDINGS.md`, which is structurally the most severe
finding in this pass — it bypasses the mechanism that decides whether
grant checks apply at all, rather than a gap in one particular check.
Registering a naive catch-all webhook rule for `namespaces` would make
this worse, not better (it would deny all namespace management
cluster-wide, since the enforcer has no `Namespace`-shaped logic at all);
a real fix needs new object-shape handling and an undecided design
question about whether changing a namespace's protection tier should
itself require a grant. Not fixed in this pass — see `CS-ADV-009` for why.

### What the webhook actually intercepts: the scale-subresource gap

Neither `examples/m2-kubernetes-enforcer/webhook-protected.yaml` nor
`webhook-default.yaml` names `deployments/scale`/`statefulsets/scale` in
its `rules[].resources`. Kubernetes routes subresource requests (`kubectl
scale`, a direct `Scale` `PATCH`, and every HorizontalPodAutoscaler-driven
resize) separately from normal object UPDATEs, and a rule naming only the
parent resource does not implicitly cover its subresources. **A protected
Deployment or StatefulSet's replica count can currently be changed through
the scale subresource with no grant check at all — not denied, simply
never routed to the enforcer.** This is a real gap in exactly the field
this milestone's own demo uses to prove the system works
(`spec.replicas`), reachable by anything with ordinary scale RBAC, no
approver identity required. Recorded as `CS-ADV-006` in
`docs/ADVERSARIAL_FINDINGS.md`, which also lays out the two remediation
options and why neither was chosen unilaterally in this pass — closing it
means either building real `Scale`-object handling or accepting that
scaling breaks entirely on protected resources until that exists, and that
tradeoff is an operational decision, not a code fix.

### What the kind demo exercised, and what only the unit suite did

The kind reproduction exercised signature verification, actor, operation,
resource, object hash, and expiry against a live API server. At the time
of the recorded run it did **not** exercise the policy-version-drift
check: `EXPECTED_POLICY_VERSION` was unset in
`examples/m2-kubernetes-enforcer/enforcer-deployment.yaml`, and the
enforcer then skipped the comparison entirely. `CS-ADV-017` found that
this was not merely a demo simplification but a deployment hazard — a
signing key surviving a policy upgrade kept every unexpired grant from the
obsolete policy set admissible — and the enforcer now defaults to the
`POLICY_VERSION` bundled in its own image, with the environment variable
demoted to an override. The demo was re-run after that change, so the
check is live in the recorded transcript (both sides are built from the same
checkout, so the demo grant passes it). The deny path for drift is covered by
`packages/kubernetes-enforcer/tests/verify.test.ts` and
`tests/integration/m2-grant-issuance-to-enforcement.test.ts`.

## Demo transcript

The full 90-second demo — authorize and exercise correctly (ALLOW), reuse
the same authorization against a modified object (DENY), and fail-closed
vs. fail-open behavior when the verifier is unreachable — ran for real
against a live `kind` cluster in a single unattended run. The reproduction
script, webhook manifests, and the unedited transcript from that run are in
`examples/m2-kubernetes-enforcer/README.md` and
`examples/m2-kubernetes-enforcer/demo-transcript.txt`.
