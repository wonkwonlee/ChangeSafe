# Adversarial Findings

This file records technically verified adversarial results. Review feedback stays
private until it is reproduced or otherwise verified.

## Finding CS-ADV-001

### Hypothesis

A copied M1 Tier 1 Terraform template could smuggle an infrastructure execution
path, or a hostile PR body could cause ChangeSafe to treat untrusted text as an
approval instruction.

### Attack surface

- `examples/m1-tier1-terraform-gate/.github/workflows/changesafe-tier1-captured-plan.yml`
- `examples/m1-tier1-terraform-gate/fixtures/hostile-pr-body.txt`
- `examples/m1-tier1-terraform-gate/fixtures/hostile-protected-destroy.tfplan.json`
- Terraform receipt verification for a supplied plan artifact

### Method

Inspect the template workflow and fixtures, then exercise the Tier 1 integration
test that checks the example repository contract. Validate the Terraform domain
rejects unexpected plan actions and the CLI rejects receipt verification against
a different Terraform plan artifact or changed PR context. It also tests a post-signing hostile
receipt mutation, a missing captured plan, and the shipped Action's fail-closed
exit contract.

### Minimal reproducer

Use the checked-in M1 Tier 1 template repository under
`examples/m1-tier1-terraform-gate/`.

- Benign case: `fixtures/benign-scale-up.tfplan.json`
- Hostile case: `fixtures/hostile-protected-destroy.tfplan.json` plus
  `fixtures/hostile-pr-body.txt`
- Fixed evidence manifest: `evidence-manifest.json`
- Workflow under test:
  `.github/workflows/changesafe-tier1-captured-plan.yml`

The regression coverage is
`tests/integration/m1-tier1-terraform-template.test.ts`,
`packages/cli/tests/cli.test.ts`, and
`packages/domain-terraform/tests/terraform.test.ts`.

### Expected invariant

ChangeSafe reads captured `terraform show -json` artifacts as data, never runs
Terraform, never applies infrastructure changes, never follows PR-body
instructions, and verifies a receipt only against the same plan artifact it
describes.

### Observed behavior

No counterexample found under attack model M1 Tier 1 captured Terraform plan reproduction without cloud credentials or Terraform execution.

The template workflow contains the pinned `changesafe@0.5.0` gate and verify
commands, does not invoke Terraform, does not install Terraform, and does not
use cloud credentials. The hostile fixture records a protected replacement plus
instruction-like PR text; expected status remains `blocked` with `CRITICAL`
risk. Receipt verification succeeds for the matching Terraform plan and fails
for a different plan or changed PR context through the canonical input hash. A modified hostile signed receipt fails signature
verification even after its receipt hash is recomputed; a missing captured plan
fails with exit code `2` and creates no receipt. The shipped Action exits `2`
for no verdict and `1` for a blocked verdict when `fail-on-block` is enabled.

### Severity

Informational negative result.

### Root cause

No defect was reproduced. The original hypothesis was not supported because the
Tier 1 template stays captured-artifact-only, hostile PR text is scanned as
untrusted data, and receipt verification binds to the input plan hash.

### Fix

No product fix from this finding. Keep the template workflow captured-artifact
only and keep receipt verification tests covering matching and mismatched
Terraform plan inputs.

### Regression test

- `tests/integration/m1-tier1-terraform-template.test.ts` verifies the manifest,
  fixture hashes, workflow boundaries, expected benign and hostile verdicts, and
  hostile signed-receipt verification, post-signing tamper rejection, missing
  plan failure, and fail-closed Action contract through the bundled CLI when
  available.
- `packages/cli/tests/cli.test.ts` verifies Terraform receipt verification
  succeeds for the same plan artifact and fails for a different plan artifact
  or changed PR context.
- `packages/domain-terraform/tests/terraform.test.ts` verifies unexpected
  Terraform actions are rejected during plan normalization.

### What this changed in the architecture

Nothing in runtime architecture changed. The useful change is evidentiary: M1
Tier 1 now has a public, reproducible captured-plan template and tests that
separate deterministic gate classification from later persistence or
realized-effect claims. A `gate_only` receipt is not an authorization.

### Remaining uncertainty

This result does not cover Tier 2 AWS sandbox execution, persistence
attestation, controller reconciliation, realized infrastructure effects,
identity/actor binding, plan freshness, workspace/state/source-revision or
M2 authorization semantics.

## Finding CS-ADV-002

### Hypothesis

A receipt's policy version is sufficient to identify the policy-pack input
that produced its findings.

### Attack surface

- `changesafe gate --policy-pack <file>`
- Terraform receipt fields and `changesafe verify`

### Method

Gate the same benign captured Terraform plan once with the default policy pack
and once with a valid stricter policy pack. Compare the resulting receipts and
their deterministic findings.

### Minimal reproducer

Run the `shows that policy-pack selection is not bound into a receipt` case in
`tests/integration/m1-tier1-terraform-template.test.ts`. It supplies a pack
with `blastRadius.warnAt: 1` and `blastRadius.blockAbove: 3` for the benign M1
fixture.

### Expected invariant

A verifier should be able to identify every policy input that materially
affected the recorded findings.

### Observed behavior

The same captured plan produces `LOW` risk with the default pack and `MEDIUM`
with the stricter pack. Both receipts retain the same `policyVersion`,
`inputSha256`, and `proposalSha256`, and neither contains a policy-pack hash.
The current verifier has no policy-pack input to cross-check.

### Severity

Medium evidence-provenance gap. It does not create an execution path or turn a
`gate_only` receipt into an approval, but a receipt alone cannot establish the
policy-pack file that shaped its findings.

### Root cause

Receipt creation records the adapter policy version and evaluated findings, not
the resolved policy-pack identity or hash.

### Fix

No M1 runtime change. Keep this limitation explicit; evaluate a policy-pack
binding design only after M1 evidence is closed and without introducing M2
authority semantics.

### Regression test

`tests/integration/m1-tier1-terraform-template.test.ts` gates the same plan
under both packs and locks the observed distinction and absent binding fields.

### What this changed in the architecture

Nothing in runtime architecture changed. M1 records the policy-pack identity
gap instead of representing policy version as proof of full policy-input
provenance.

### Remaining uncertainty

This finding does not establish a remediation, bind plan freshness,
workspace/state/source revision, or address Tier 2 effects or M2 authority.

## Finding CS-ADV-003

### Hypothesis

The `objectHashOf` exclusion in `packages/kubernetes-enforcer/src/verify.ts`,
which drops the `changesafe.dev/grant` annotation before hashing an admitted
object, could be silently broken or silently widened (excluding annotations
generally, not just the grant annotation) without any test noticing.

### Attack surface

- `packages/kubernetes-enforcer/src/verify.ts`'s non-exported `objectHashOf`
  helper, reached only through `verifyGrantAgainstAdmission`.
- `packages/kubernetes-enforcer/tests/verify.test.ts`, Task 8's 8-case
  attack suite.

### Method

A task reviewer inspected `verify.test.ts` after the kind-cluster
reproduction (Task 10 Step 4, commit `369e51a`) and found that the test
file's own local `objectHashOf` helper — used only to compute expected
`objectSha256` values for fixtures — hashed `{ identity, metadata, spec }`
with no exclusion logic at all, and the shared `RESOURCE` fixture had no
`annotations` field. The production exclusion in `src/verify.ts` was
therefore never exercised by any of the 8 existing tests; they passed only
because the exclusion is a no-op on annotation-less fixtures.

### Minimal reproducer

`packages/kubernetes-enforcer/tests/verify.test.ts`, two tests added in the
fix round on commit `3332773`:

- "allows once the grant annotation itself is attached to the admitted
  object" — issues a grant against an annotation-less resource, then admits
  a copy of that resource with the `changesafe.dev/grant` annotation
  attached, and asserts `{ allowed: true }`. Had the production exclusion
  been a no-op or removed, attaching the annotation would have changed the
  computed hash and produced a DENY instead.
- "denies when a different annotation is tampered with after
  authorization" — issues a grant against a resource carrying an unrelated
  annotation, then admits a copy with that annotation's *value* changed
  (not the grant annotation), and asserts `allowed: false`. This proves the
  exclusion is scoped to exactly `changesafe.dev/grant` and not to
  annotations generally, since a broadened exclusion would be a bypass.

### Expected invariant

A grant's `objectSha256` must be computed identically on the issuing side
(object with no grant annotation yet) and the verifying side (object with
the grant annotation attached), and no other annotation may be excluded
from that hash.

### Observed behavior

Both new tests passed on their first run against the existing, unmodified
production `objectHashOf` (`packages/kubernetes-enforcer/tests/verify.test.ts`,
10/10 tests passing after the fix round). The production exclusion logic
itself was correct from the start — the gap was in test coverage, not in
the shipped behavior: nothing had ever forced the exclusion path to run.

### Severity

Low-to-medium test-coverage gap. It did not represent a live defect in
production behavior, but it left the object-substitution attack case's
adjacent annotation-tampering variant completely unverified — a regression
that broke or widened the exclusion could have shipped undetected.

### Root cause

`verify.test.ts`'s hand-rolled `objectHashOf` test helper diverged from the
real, non-exported `objectHashOf` in `src/verify.ts` without either helper
being kept in sync, and the shared `RESOURCE` fixture never exercised an
object carrying any annotations at all.

### Fix

Added the two tests above, which reach the real production `objectHashOf`
through `verifyGrantAgainstAdmission` rather than duplicating the exclusion
logic in the test file, so a future change to the exclusion is exercised
directly instead of through a parallel implementation that could drift.

### Regression test

`packages/kubernetes-enforcer/tests/verify.test.ts` — 10/10 tests passing,
including the two annotation-exclusion cases above.

### What this changed in the architecture

Nothing in runtime architecture changed; the shipped exclusion logic was
correct before and after this finding. The change is test coverage only.

### Remaining uncertainty

This finding does not address `main.ts`'s `readGrantFromAnnotation`, which
has no dedicated unit test (explicitly deprioritized in the same fix round
as lower value than standing up a new test file for one small function). It
also does not address ledger recording, nonce/replay defenses, or E2/E3
persistence — all explicitly deferred per the M2 design spec.

## Finding CS-ADV-004

### Hypothesis

An `AuthorizationGrant` issued by `packages/server` binds an approved decision
to the operation, resource, and canonical object that decision was actually
about, as the M2 design spec's data flow states ("operation, resource,
object_sha256 = derived from the same evaluated proposal (never re-entered)").

### Attack surface

- `GrantRequestSchema` and the `POST /reviews/:id/decisions` route in
  `packages/server/src/http.ts`
- `DecisionService#issueGrant` in `packages/server/src/decisions.ts`
- `packages/kubernetes-enforcer/src/verify.ts`'s
  `verifyGrantAgainstAdmission`, which consumes whatever binding it is given

### Method

Approve a real durable review in one domain (a network incident) through the
authenticated OIDC decision route, and request a grant in the same call whose
`resource` names a Kubernetes-shaped resource that review never mentioned and
whose `objectSha256` is an arbitrary hash belonging to no object. Inspect the
signed grant the server returns.

### Minimal reproducer

`packages/server/tests/reviews.test.ts`, the case "issues a grant whose
resource and object hash the caller chose, unchecked". It decides
`review-grant-unbound` (a network review) with
`resource: "deployments/prod/unrelated-workload"` and
`objectSha256: "b".repeat(64)`.

### Expected invariant

Every field a grant binds should be derived server-side from the same
evaluated proposal the receipt records, so a grant cannot authorize an object
or resource the approved decision was not about.

### Observed behavior

The server accepts the request, issues a signed grant carrying exactly the
caller's `resource` and `objectSha256`, and returns HTTP 201. Only `receiptId`
and `policyVersion` are server-derived; `operation`, `resource`, and
`objectSha256` are copied unchanged from the request body with no
cross-check against the reviewed proposal. The enforcer then verifies the
admission request against that caller-chosen binding faithfully — it has no
way to know the binding was never derived.

### Severity

Medium authorization-provenance gap. It creates no execution path, does not
weaken any BLOCK finding, and cannot be reached without an authenticated
approver identity: the actor who can mint a mis-bound grant is the actor who
could have approved the corresponding change anyway. What it breaks is the
claim the grant makes about *itself* — that its object binding descends from
the decision it names.

### Root cause

Grant issuance was wired as a request-shaped feature of the decision endpoint
rather than as a projection of the evaluated proposal. Deriving the binding
server-side requires per-domain extraction of a stable resource id and a
canonical object hash from a receipt's proposal, which no domain currently
exposes to the server.

### Fix

No runtime fix in this pass; the gap is recorded rather than papered over.
Server-side derivation is a future milestone with its own design (a
`DomainAdapter`-level contract for "the resource and canonical object this
proposal targets"), not a patch to a fix wave. `docs/M2_TECHNICAL_NOTE.md`
now states plainly which grant fields are authoritative and which are
caller-asserted.

### Regression test

`packages/server/tests/reviews.test.ts` locks the current behavior, gap
included, so it is visible in the suite rather than only in prose; adding
server-side derivation must fail that test and rewrite it.
`tests/integration/m2-grant-issuance-to-enforcement.test.ts` covers the
composed issuance-to-enforcement chain that made this gap visible.

### What this changed in the architecture

Nothing in runtime architecture changed. The change is claim discipline: a
grant is documented as proving *which approved decision exists*, not that the
object it authorizes is the object that decision was about.

### Remaining uncertainty

This finding does not establish whether a mis-bound grant is reachable by any
identity weaker than an authenticated approver, does not address grants in the
ledger, nonce/replay, or E2/E3 persistence, and does not evaluate a design for
per-domain binding derivation.

## Finding CS-ADV-005

### Hypothesis

`kubernetesObjectSha256` (`packages/kubernetes-enforcer/src/verify.ts`), the
hash both grant issuance and admission-time verification use to bind a grant
to an exact object state, captures every field of the admitted object that
matters to what actually runs — not just the fields today's Kubernetes
policies happen to read.

### Attack surface

- `packages/kubernetes-enforcer/src/verify.ts`'s `kubernetesObjectSha256`
  (before this fix: built on `normalizeRawResource`)
- `packages/domain-kubernetes/src/normalize.ts`'s `normalizeRawResource`,
  whose own doc comment states its actual purpose: "Project a raw
  Kubernetes API object into the strict policy-relevant model. Server-owned
  metadata, status, and unselected spec fields are discarded."

### Method

Found by external review (a Codex-based automated review of PR #75) rather
than an internal exercise of the adversarial gate; reproduced and confirmed
against the actual normalization code before being recorded here, per this
file's own promotion rule that review feedback is not a finding until
verified. Construct two Deployment objects identical except for a container
`command` array, and compare both `normalizeRawResource`'s projected spec
and `kubernetesObjectSha256`'s hash for each.

### Minimal reproducer

- `packages/kubernetes-enforcer/tests/verify.test.ts`, "denies when a field
  the policy projection discards is changed post-authorization (CS-ADV-005)"
- `packages/domain-kubernetes/tests/normalize.test.ts`, describe block
  `canonicalizeAdmittedResource`, "preserves spec fields the policy
  projection discards (CS-ADV-005)"

### Expected invariant

A grant's `objectSha256` must change whenever the admitted object's `spec`
changes in any field, so a grant issued for one object can never be reused,
even partially, to authorize a materially different one.

### Observed behavior

`normalizeRawResource`'s per-kind spec projection (built for policy
evaluation) keeps only the fields today's five Kubernetes policies read —
for a container, only `name`, `image`, and a `securityContext` subset;
`command`, `args`, `env`, `resources` (limits/requests), and ports are never
projected in at all. `kubernetesObjectSha256` reused that projection as its
hash input (fix #4 of the branch's earlier final-review fix wave unified
three separate hash implementations onto this one function, but that
function's underlying projection was itself already lossy — unifying it
made the drift risk go away without touching this gap). Two admission
requests whose containers differ only in `command`/`args`/`env`/`resources`
produced the identical `objectSha256`, so a grant issued against one
admitted the other. This directly defeats the exact-object binding the
whole M2 milestone exists to provide, for exactly the class of field a
malicious or careless post-authorization edit would target.

### Severity

Critical for the milestone's central safety claim. Reachable by anyone who
can both obtain a valid grant for *a* Deployment/StatefulSet/DaemonSet/
Service (the same authenticated-approver reachability class as CS-ADV-004)
and subsequently submit a modified manifest for admission — no signature
forgery or actor/operation/resource substitution needed, only editing a
field the hash never covered. Unlike CS-ADV-004 (an authorization-provenance
gap that widens who a grant trusts), this is a false ALLOW on a materially
different object, the exact failure mode Decision 4/5 designed the object
hash to prevent.

### Root cause

Decision 5's design spec reasoned that reusing the existing normalization
pipeline was safe because it "uses `z.looseObject` to keep only known,
policy-relevant fields" and drops only K8s server-owned additions (`uid`,
`resourceVersion`, `managedFields`, `creationTimestamp`, defaulted fields).
That premise was false: the pipeline's per-kind spec projection was written
for policy evaluation and discards real, user-authored spec content no
current policy inspects — a materially different category of loss than
"server-owned metadata," which the spec's own reasoning did not
distinguish.

### Fix

`packages/domain-kubernetes/src/normalize.ts` gains
`canonicalizeAdmittedResource`, a second, purpose-built function for
authorization-binding hashes: identical envelope parsing and identity
derivation to `normalizeRawResource`, but the entire `spec` is kept verbatim
rather than routed through the kind-specific policy projection. Only
`metadata`'s explicitly server-owned/managed keys are excluded, matching
what Decision 5 always intended. `normalizeRawResource` itself is
unchanged — it still serves policy evaluation, which is a different
consumer with a different (and correct) reason to be selective.
`kubernetesObjectSha256` now calls the new function.

This intentionally does NOT normalize away K8s server-side spec defaulting
(e.g. an omitted `strategy.type` becoming `"RollingUpdate"`), so a grant
issued against a manifest that omits a field the API server later defaults
can mismatch and produce a false DENY at admission time. That is the
accepted, safe failure direction for an authorization gate: a spurious DENY
costs availability; a spurious ALLOW — CS-ADV-005 itself — costs the
authorization boundary's entire purpose. Operators should compute a grant's
`objectSha256` against the object as the API server will actually admit it
(e.g. via a dry-run apply), not the raw authored manifest, documented in
`packages/domain-kubernetes/src/normalize.ts`'s doc comment on the new
function.

### Regression test

`packages/kubernetes-enforcer/tests/verify.test.ts` and
`packages/domain-kubernetes/tests/normalize.test.ts` both assert that a
`command`-only change produces a different canonical hash and, at the
`verifyGrantAgainstAdmission` layer, an explicit DENY — proven to fail
against the pre-fix code (the old projection produced identical hashes for
both objects).

### What this changed in the architecture

`packages/domain-kubernetes` now exposes two normalization entry points
with deliberately different completeness guarantees for deliberately
different consumers: `normalizeRawResource` (policy-relevant projection) and
`canonicalizeAdmittedResource` (full-fidelity, authorization-binding). Both
share envelope parsing and identity derivation so they cannot silently
diverge on what counts as the same resource, only on how much of its spec
they retain.

### Remaining uncertainty

This fix does not address K8s server-side spec defaulting divergence
between gate-time and admission-time hashing (documented above as an
accepted availability cost, not resolved), does not extend to any resource
kind beyond the four this domain already supports, and — like CS-ADV-004 —
does not change that the object hash itself is still caller-asserted at
issuance time rather than server-derived from a reviewed proposal.

### Amendment: `metadata` had the identical bug, one layer up

Found by a second round of the same external review, on the fix commit
itself. `canonicalizeAdmittedResource`'s first version fixed `spec` but
still projected `metadata` down to an include-list of exactly
`annotations`/`labels` — the identical class of gap the rest of this
finding describes, just relocated: `finalizers` and `ownerReferences` are
both real, client-controllable `ObjectMeta` fields (garbage-collection and
deletion-blocking behavior respectively) that never entered the hash, so
changing either after authorization went undetected the same way an
unhashed spec field did.

Fixed in the same function by inverting the approach: instead of building
`metadata` from an include-list of named fields, it now takes the full
parsed `metadata` object and deletes an explicit exclude-list of
server-owned/managed keys (`resourceVersion`, `uid`, `generation`,
`managedFields`, `creationTimestamp`, `deletionTimestamp`,
`deletionGracePeriodSeconds`, `selfLink`, `clusterName`, plus `name`/
`namespace` which `identity` already carries). An unrecognized future
metadata field now defaults to being *included* in the hash, which can only
cost an extra false DENY — never silently reintroduce this bug class for a
field nobody thought to name. Regression test: `canonicalizeAdmittedResource`
describe block in `packages/domain-kubernetes/tests/normalize.test.ts`,
"includes client-owned metadata the first version discarded (finalizers,
ownerReferences)" — fails against the intermediate (spec-fixed,
metadata-still-broken) code.

## Finding CS-ADV-006

### Hypothesis

`examples/m2-kubernetes-enforcer/webhook-protected.yaml` and
`webhook-default.yaml` intercept every UPDATE that changes a protected
Deployment or StatefulSet's replica count.

### Attack surface

- `examples/m2-kubernetes-enforcer/webhook-protected.yaml` and
  `webhook-default.yaml`'s `rules[].resources` lists
- `packages/kubernetes-enforcer/src/admission-review.ts`'s
  `AdmissionRequestSchema`, which has no `resource`/`subResource` fields to
  detect this case even if a request did arrive

### Method

Found by external review (Codex, on PR #75); verified against Kubernetes'
own admission-control contract rather than taken on faith. Kubernetes
requires a `ValidatingWebhookConfiguration` rule to name a subresource
explicitly (`"deployments/scale"`) to intercept requests to it — a rule
listing only `"deployments"` does not implicitly cover `deployments/scale`,
and `kubectl scale`, a `Scale` subresource `PATCH`, and every
HorizontalPodAutoscaler-driven resize all go through that subresource, not
a normal object UPDATE.

### Minimal reproducer

Not a runnable test — this is a webhook-routing gap, not application logic
the unit suite can exercise: `packages/kubernetes-enforcer`'s server would
correctly deny a `Scale`-shaped admission object if one ever reached it
(`Scale`'s `kind` is not one of the four kinds `identityOfRawResource`
supports, so `canonicalizeAdmittedResource` throws and the malformed-input
handling from `CS-ADV-005`'s sibling fix (`87765ad`, PR #75) answers with an
explicit deny). The gap is that Kubernetes never routes the request to the
webhook at all when `resources` doesn't name the subresource, so that deny
path is never reached — the reproducer would require a live cluster and
`kubectl scale`, not a unit test.

### Expected invariant

Every UPDATE to a protected workload's replica count — however it arrives —
requires a valid grant, matching `K8S_WORKLOAD_AVAILABILITY`'s own existing
treatment of replica changes as policy-relevant
(`packages/domain-kubernetes/src/policies/workload-availability.ts`), and
matching AGENTS.md's "a missing verdict must never read as approval."

### Observed behavior

Neither webhook configuration's `rules[].resources` names `deployments/scale`
or `statefulsets/scale`. A `kubectl scale`, a direct `Scale` subresource
`PATCH`, or an HPA-driven resize is never sent to the enforcer at all — not
denied, not evaluated, simply never routed there by the API server. This is
a silent, total, undetectable bypass of every grant check (signature,
actor, object hash, expiry) for exactly the field this milestone's own
90-second demo uses to prove the system works (`spec.replicas`).

### Severity

High — higher than `CS-ADV-004`. That gap requires an already-authenticated
approver to exploit; this one requires no privileged actor at all —
anything with ordinary `scale` RBAC (which is broader than, and
independent of, whatever RBAC gates a normal `PATCH`), or an HPA object
already present in the cluster for entirely unrelated reasons, bypasses the
grant system automatically and continuously. No BLOCK finding is weakened
and no signature is forged — the request simply never reaches a point
where either would be checked.

### Root cause

The webhook manifests and the `AdmissionRequestSchema` were both written
against the milestone's demo path (`kubectl apply`/`patch` against the
normal object endpoint) without accounting for Kubernetes' separate
subresource routing for `scale`, `status`, and others. Nothing in the M2
design spec's data flow or the implementation plan mentions subresources.

### Fix

Not fixed in this pass — this needs a real design decision, not a drive-by
webhook YAML edit, because the two available options are both consequential
and neither is obviously correct without an operator's input:

1. **Register `deployments/scale`/`statefulsets/scale` and build real
   `Scale`-object handling** — extend `AdmissionRequestSchema` with the
   `resource`/`subResource`/`namespace`/`name` fields the real
   `AdmissionReview.request` carries (present today only as
   `z.looseObject`'s passthrough, not modeled), resolve identity from those
   fields rather than the `Scale` object's own `apiVersion`/`kind` (which
   don't self-report as `Deployment`/`StatefulSet`), and decide what a
   `Scale`-subresource grant binds to given `Scale`'s payload is far
   smaller than a full object hash. Real work with its own design, not a
   fix-wave patch.
2. **Register the subresource with no `Scale` handling built**, which
   (given the existing malformed-input handling) means every scale
   operation on a protected-tier resource is unconditionally denied —
   converts a silent bypass into a loud, safe failure, but breaks
   HPA-driven autoscaling entirely for protected resources until (1) is
   built. A real availability cost, and a decision about cluster behavior
   this repository should not make unilaterally in a PR review response.

Neither is implemented here. This finding exists so the gap is visible and
prioritizable rather than discovered later.

### Regression test

None — see Minimal reproducer above for why this is not unit-testable
without a live cluster.

### What this changed in the architecture

Nothing. This is a documented gap, not a code change.

### Remaining uncertainty

Whether `daemonsets`/`services` have analogous subresource-routing gaps for
operations this system cares about has not been checked. Whether option 1
or 2 above (or leaving the gap open) is the right call is an operational
decision this finding surfaces but does not make.

## Finding CS-ADV-007

### Hypothesis

If a client disconnects after `POST /reviews/:id/decisions` durably
resolves a decision (the receipt is ledgered, and — when requested — a
grant is signed) but before the response reaches it, retrying the same
request recovers the grant rather than losing it.

### Attack surface

- `packages/server/src/http.ts`'s `POST /reviews/:id/decisions` handler
- `packages/server/src/durable-review-store.ts`'s `DurableReviewStore#resolvePending`
  and `#claimDecision`
- `packages/server/src/decisions.ts`'s `#recoverSignedOutcome` (the
  existing idempotent-recovery path for `decideSigned`, referenced by an
  `http.ts` comment as covering this — verified below that it does not,
  for this specific window)

### Method

Found by external review (Codex, on PR #75); traced through the actual
call chain rather than accepted at face value, since an `http.ts` comment
already claimed recovery worked ("the decision is idempotent by
`receiptId`, so replaying the same request recovers the stored outcome via
`#recoverSignedOutcome`"). Read `#claimDecision`'s three-way branch
(`durable-review-store.ts`): no pending review → reject; a resolution
already exists → `ILLEGAL_TRANSITION`; a claim exists but no resolution yet
→ return the existing claim and proceed. Confirmed the middle branch — the
one that actually reaches `#recoverSignedOutcome` — only covers the narrow
window between claiming a decision and appending its resolution (e.g. a
mid-request crash), not the window this finding is about: after the
resolution is fully appended.

### Expected invariant

A response the server already committed to (a signed receipt in the
ledger, a signed grant derived from it) is recoverable by the client that
requested it, not stranded because one HTTP response failed to arrive.

### Observed behavior

Once `#appendResolution` succeeds, any retry of the same
`POST /reviews/:id/decisions` request hits `#claimDecision`'s
`getResolution(...)` check first and throws `ILLEGAL_TRANSITION`
immediately — `resolvePending`'s `issue` callback (which calls
`decideSigned`/`issueGrant`) is never invoked again, so
`#recoverSignedOutcome` is never reached for this window. The receipt
itself remains recoverable via `GET /reviews/:id/receipt-proof`
(`options.reviews.getResolution`), but that resolution record carries only
receipt fields — no grant. A grant that was signed and returned in a
response the client never received exists nowhere durable: not in the
ledger (deliberately, per this file's own `packages/ledger` stays
receipt-only note above), not in the resolution record, and not
recoverable by retry. The client's only recourse is a new review and
decision cycle to obtain a replacement grant for the same already-approved
change.

### Severity

Medium — an availability/operability gap, not a security bypass: no BLOCK
finding is weakened, no forged signature is accepted, and the failure mode
is "cannot obtain a valid grant" rather than "obtains an invalid one." The
cost falls on the legitimate caller, not on an attacker.

### Root cause

Grant issuance was added onto an existing idempotent-recovery design built
for receipts alone. `#recoverSignedOutcome` genuinely does make
`decideSigned` idempotent by `receiptId` — but `resolvePending`'s own
resolution-exists guard, which predates grants entirely, fails the whole
request closed before that recovery path is ever reached. The `http.ts`
comment describing this as covered was accurate for the receipt but did
not account for the grant riding along on the same, single, unrepeatable
response.

### Fix

Not fixed in this pass. This is the counterexample the M2 design spec's
own "Explicitly deferred" section named in advance: "Grants in the ledger
... Attack case to test: can a grant exist and be exercised with no
durable record that it was ever issued? If the M2 adversarial gate finds
this is a real audit gap, extend the ledger then." This finding is that
audit gap, concretely: a grant existed, was signed, and is now
unrecoverable and untracked. Whether to act on the spec's own stated
trigger (persist issued grants, e.g. alongside the resolution record) is a
call for whoever owns this milestone next, not something to build
unilaterally in a PR review response — it reopens deferred scope with its
own design questions (what persisted-grant storage looks like, whether
`packages/ledger` is the right home or a separate durable-review-store
table, and how `CS-ADV-004`'s issuance-binding gap interacts with any
persisted record).

### Regression test

None. Reproducing the exact race (append succeeds, response is dropped)
needs fault injection into the HTTP response path, not covered by the
existing test doubles.

### What this changed in the architecture

Nothing. This is a documented gap, not a code change. It also corrects an
inaccurate code comment: `packages/server/src/http.ts`'s claim that
`#recoverSignedOutcome` covers "replaying the same request" is true only
for the pre-resolution crash window, not for a response lost after full
commit — worth fixing the comment's wording in a future pass even without
building the underlying recovery mechanism.

### Remaining uncertainty

Whether the same unrecoverable-response class of gap exists for the
receipt itself in any other durable route, independent of grants, has not
been checked — `GET /reviews/:id/receipt-proof` appears to cover the
receipt specifically, but that was not exhaustively verified here.

## Finding CS-ADV-008

### Hypothesis

`verifyGrantAgainstAdmission`'s actor check binds a grant to the specific
Kubernetes principal it was issued for, not merely to a username string
that principal happened to hold at issuance time.

### Attack surface

- `packages/kubernetes-enforcer/src/verify.ts`'s actor comparison
- `packages/core/src/grant.ts`'s `AuthorizationGrantSchema`, which (before
  this fix) had no field for a Kubernetes uid at all

### Method

Found by external review (Codex, on PR #75); verified against Kubernetes'
own identity model rather than taken on faith. Kubernetes' `userInfo.uid`
is tied to the specific `ServiceAccount` (or other principal) object, not
its name: deleting and recreating a `ServiceAccount` preserves the
`username` string but Kubernetes assigns the new object a new `uid`. A
name-based `RoleBinding` (matching on the subject's `name`, the common
case) restores the same access to the replacement principal.

### Minimal reproducer

`packages/kubernetes-enforcer/tests/verify.test.ts`, "denies when the same
username belongs to a different uid (CS-ADV-008: recreated ServiceAccount)"
— builds a grant for `authorizedActor: ACTOR` with a specific
`authorizedActorUid`, then verifies an admission request from the same
`username` but a different `uid`, and confirms the pre-fix comparison
(username only) would have allowed it.

### Expected invariant

A grant authorizes the specific principal it was issued for, not any
future principal that happens to share that principal's name.

### Observed behavior

`verifyGrantAgainstAdmission` compared only `grant.authorizedActor` against
`request.userInfo.username`. `AuthorizationGrantSchema` had no field for
`userInfo.uid` at all, so no comparison against it was possible even in
principle. A grant issued for `system:serviceaccount:ops:changesafe-
applier` remained valid for admission requests from ANY principal
presenting that same username, regardless of whether it was the same
underlying Kubernetes object the grant was actually issued for.

### Severity

Medium. Reachable only by whoever can delete and recreate a specific
already-privileged ServiceAccount (or otherwise cause a new principal to
receive the same username) within the grant's expiry window and while a
name-based RoleBinding restores its access — a real, non-trivial attack
path, but one requiring the target account's deletion first, which is
itself a privileged and typically auditable action.

### Root cause

Spec Decision 3 says `authorized_actor` is compared "directly against
Kubernetes' own `AdmissionReview.request.userInfo`" — accurate as written,
but the implementation only ever read one field of that structure
(`username`) despite `userInfo.uid` already being modeled in
`AdmissionUserInfoSchema` as an available (if optional) field. Not a
violation of Decision 3's "no new ChangeSafe-owned identity system"
constraint to fix — `uid` is Kubernetes' own vocabulary, not a new one —
just an incomplete first use of it.

### Fix

`AuthorizationGrantSchema` gains `authorizedActorUid` (optional, since not
every identity provider populates a stable uid). Threaded through
`IssueGrantOptions` (`packages/server/src/decisions.ts`) and
`GrantRequestSchema` (`packages/server/src/http.ts`) alongside the
existing `authorizedActor`. `verifyGrantAgainstAdmission` now additionally
compares `grant.authorizedActorUid` against `request.userInfo.uid` when
BOTH are present; when either side lacks one, verification falls back to
the pre-existing username-only comparison — backward compatible with
already-issued grants and identity providers that never supply a uid.

### Regression test

`packages/core/tests/grant.test.ts`, "accepts a grant carrying the actor's
Kubernetes uid alongside its username"; `packages/kubernetes-enforcer/
tests/verify.test.ts`'s three new cases (denies on uid mismatch even with
matching username, allows when no uid is present on either side, allows
when both uids match) — all pass against the fixed code and the first
would fail against the pre-fix comparison.

### What this changed in the architecture

`AuthorizationGrantSchema` gained one optional field. No new identity
system, no new dependency, no change to the signature/canonicalization
scheme beyond the new field itself being part of what gets signed.

### Remaining uncertainty

Whether other Kubernetes identity fields (`groups`, `extra`) carry
analogous binding gaps has not been evaluated — this finding addresses
`uid` specifically because it was the one raised and verified, not because
a broader audit of `userInfo`'s full shape was performed.

### Amendment: the check was symmetric when it needed to be asymmetric

Found by a second round of the same external review, on the fix commit
itself. The first version only compared uids "when both sides have one" —
`grant.authorizedActorUid !== undefined && request.userInfo.uid !==
undefined && ...`. Since `AdmissionUserInfoSchema` permits an absent uid,
an admission request from an authenticator that never populates
`userInfo.uid` (or one routed to appear that way) silently skipped the
check entirely and fell back to username-only matching — defeating a
grant that specifically opted into uid-binding, exactly the protection
this finding exists to provide.

Fixed by making the condition asymmetric: whether the check applies is the
*issuer's* choice (did they set `authorizedActorUid` when building the
grant?), not the admission request's. If the grant carries a uid, the
request must carry the identical one or be denied outright — a missing
`request.userInfo.uid` is now a deny, not a silent downgrade. A grant
issued with no uid at all (the still-supported weaker binding) is
unaffected. Regression test: "denies a uid-bound grant when the request's
uid is missing (CS-ADV-008 follow-up)" in
`packages/kubernetes-enforcer/tests/verify.test.ts` — fails against the
symmetric (first-version) condition.

## Finding CS-ADV-009

### Hypothesis

The `changesafe.dev/tier: protected` namespace label — the sole signal
that routes a workload's admission requests to the fail-closed
(`webhook-protected.yaml`) vs. fail-open (`webhook-default.yaml`)
configuration — is itself protected from being changed without going
through the same grant system it exists to gate into.

### Attack surface

- `examples/m2-kubernetes-enforcer/webhook-protected.yaml` and
  `webhook-default.yaml`'s `rules[].resources` (both list only
  `deployments`, `statefulsets`, `daemonsets`, `services` — never
  `namespaces`)
- Whatever RBAC grants `namespace` label-edit permission in a real
  cluster, which is commonly a different, sometimes broader role than
  workload-edit RBAC (platform/infra teams often manage namespaces without
  owning the applications inside them)

### Method

Found by external review (Codex, on PR #75); verified by reading both
webhook manifests directly rather than accepted on description alone —
confirmed neither `rules` block names `namespaces` as a covered resource.
Also checked whether any EXISTING policy protects this label:
`packages/domain-kubernetes/src/policies/protected-resource.ts`'s
`K8S_PROTECTED_RESOURCE` policy protects the `changesafe.dev/protected`
RESOURCE annotation at gate time — a related but entirely separate
mechanism from the `changesafe.dev/tier` NAMESPACE label used purely for
admission-time webhook routing. Nothing protects the latter.

### Minimal reproducer

Not a runnable test — same category as `CS-ADV-006`, a webhook-routing gap
rather than application logic the unit suite can exercise. In a live
cluster: as any principal with RBAC to patch Namespace labels (not
workload RBAC), remove or change `changesafe.dev/tier: protected` on a
namespace holding grant-protected workloads. No admission review is
generated for this change at all — the API server has no webhook
registered to intercept it.

### Expected invariant

The classification that decides whether a namespace's workloads are
fail-open or fail-closed cannot itself be changed by an action the grant
system never evaluates.

### Observed behavior

Removing or altering the tier label succeeds unconditionally, with no
grant check, no signature, no actor binding — nothing, because the label
lives on a resource kind (`Namespace`) neither webhook configuration's
`rules` covers. Every subsequent admission request for that namespace's
workloads is then evaluated by `webhook-default.yaml`'s `failurePolicy:
Ignore` instead of `webhook-protected.yaml`'s `failurePolicy: Fail` — the
entire two-tier trust model silently downgrades from fail-closed to
fail-open for every future change, and nothing in the system ever
evaluates whether that downgrade itself should have required
authorization.

### Severity

Critical — structurally, the most severe finding in this pass. Every other
finding here (`CS-ADV-005` through `CS-ADV-008`) concerns a gap in how
*individual* grant checks are computed or bound; this one bypasses the
mechanism that decides whether grant checks apply to a namespace's
workloads *at all*, and the actor who can exploit it needs only
namespace-label RBAC, not any workload-level access and not a stolen or
misused grant. It is also the one finding in this document that requires
no interaction with the grant system whatsoever to exploit — the tier
label is plain Kubernetes metadata the enforcer never sees a request for.

### Root cause

Decision 4's two-tier `failurePolicy` design (per the M2 design spec and
the empirical kind-cluster finding that `objectSelector` cannot match
annotations) routes by namespace label because "namespace labels ARE
selectable" (per `webhook-protected.yaml`'s own comment) — but nothing in
that design considered that the routing signal itself needed the same
protection as the resources it routes. The webhook manifests were scoped
to the milestone's stated resource kinds (Deployment/StatefulSet/
DaemonSet/Service) without accounting for the namespace-level metadata the
whole routing scheme depends on.

### Fix

Not fixed in this pass — closing it is real, undecided design work, not a
YAML tweak:

1. **A `namespaces`/UPDATE rule alone, with no new logic, is not enough
   and is actively harmful if built carelessly.** Registering it against
   the existing enforcer would deny EVERY namespace update outright (the
   enforcer's malformed-input handling denies any object it can't
   normalize, and `Namespace` is not one of the four supported kinds) —
   correctly closing this gap but breaking all namespace management
   cluster-wide, an availability regression far larger than the security
   gap it would fix.
2. **A real fix needs new, `Namespace`-specific logic**: detect
   specifically whether `changesafe.dev/tier` changed between `oldObject`
   and `object` (not just deny all namespace updates), and decide what
   authorizes that specific change — does altering a namespace's
   protection tier go through the same grant flow as a workload change
   (bootstrapping question: who approves a decision to change a namespace
   FROM protected TO unprotected?), or is it deliberately kept outside the
   grant system and gated by RBAC alone with just a webhook-level DENY as
   a backstop against accidental drift? Both are defensible; neither
   should be decided inside a PR review response.
3. Whether `Namespace` DELETE (which also destroys the label along with
   the whole namespace) needs separate consideration wasn't evaluated
   here either.

### Regression test

None — see Minimal reproducer above for why this needs a live cluster, not
a unit test.

### What this changed in the architecture

Nothing. This is a documented gap, not a code change.

### Remaining uncertainty

Whether this is exploitable by an identity narrower than "can edit
Namespace labels" (e.g. via a mutating webhook, a controller with
namespace-edit RBAC for an unrelated purpose, or a compromised operator)
was not investigated. Whether `daemonsets`/`services`' own namespace
membership could be independently reassigned to route around this some
other way was not checked either.

## Finding CS-ADV-010

### Hypothesis

A grant that passes the durable decision route's pre-ledger expiry check
retains a meaningful, usable window once it actually reaches the caller.

### Attack surface

- `packages/server/src/http.ts`'s pre-ledger `expiresAtUtc` check (the
  `grantIssuedAtUtc`/atomic-clock fix from `CS-ADV-007`'s sibling race fix)

### Method

Found by external review (Codex, on PR #75), as a follow-up on the
already-fixed clock-race issue; verified by tracing the actual sequence of
work between the pre-check and the response reaching the caller rather
than accepted on description. The pre-check (`expiresAtUtc >
grantIssuedAtUtc`) runs before `resolvePending` — which appends a ledger
entry, real I/O — and the HTTP response still has to serialize and
transmit after that. None of that elapsed time was accounted for.

### Minimal reproducer

`packages/server/tests/reviews.test.ts`, "refuses a grant whose window is
too short to survive issuance and delivery" — issues a decision with
`expiresAtUtc` set to exactly 2 seconds after a FIXED captured
`grantIssuedAtUtc` (deterministic, using an isolated server + non-advancing
clock rather than the file's normal incrementing fake clock, so the
2-second gap is exact and not subject to how many clock reads happen to
land between requests). Confirmed to return 201 (accepted) against the
pre-fix check and 400 (rejected) against the fix.

### Expected invariant

A grant's expiry window, once it reaches the caller, is never so short
that ordinary issuance latency has already consumed it.

### Observed behavior

The pre-ledger check only required `expiresAtUtc` to be strictly after the
captured `grantIssuedAtUtc` — any margin above zero passed, including one
millisecond. `resolvePending`'s ledger append and the response
transmission both still take real wall-clock time afterward, so a caller
requesting a very short-lived grant (whether by mistake or by design)
could receive a 201 with a grant that the enforcer's real-clock check
(`verifyGrantAgainstAdmission`) would immediately treat as already
expired — a committed, successfully-issued approval that was never
actually usable.

### Severity

Low-medium. Not a security bypass (nothing is authorized that shouldn't
be) — the failure direction is the safe one, an unusable grant, not an
overly permissive one. The cost is caller confusion/wasted round trips for
a narrow, self-inflicted input (requesting a near-immediate expiry), not
an externally-exploitable attack.

### Root cause

`CS-ADV-007`'s sibling clock-race fix made the pre-check and the grant's
recorded `issuedAtUtc` use one atomically-captured instant, closing the
race where the two could disagree — but "the two values agree" and "the
gap between them is large enough to survive real issuance latency" are
different properties, and only the first was actually checked.

### Fix

Added `MIN_GRANT_LIFETIME_MS = 5000` (`packages/server/src/http.ts`): the
pre-ledger check now requires `expiresAtUtc - grantIssuedAtUtc >=
5000ms`, not merely `> 0`. A deliberately generous, round number for
ledger-append-plus-response-transmission latency, not a measured bound.

### Regression test

`packages/server/tests/reviews.test.ts`'s new test (see Minimal reproducer
above) — verified to fail against the pre-fix check before the fix was
restored.

### What this changed in the architecture

Nothing structural — one constant and a stricter inequality in an existing
check.

### Remaining uncertainty

5000ms is a chosen, not measured, margin — no production latency data
informed it. If `resolvePending` or response transmission is ever slower
than that in a real deployment (e.g. a heavily loaded ledger), the same
class of gap could reappear at a longer timescale; this fix narrows the
window, it does not make the check latency-independent (e.g. by measuring
actual elapsed time and re-validating just before the response is sent).

## Finding CS-ADV-011

### Hypothesis

`verifyGrantAgainstAdmission`'s exported public contract — "verify a signed
AuthorizationGrant authorizes exactly this admission request: correct
signer, actor, operation, resource, object state..." — cannot be weakened
by how a caller invokes it; the resource binding is always checked.

### Attack surface

- `packages/kubernetes-enforcer/src/verify.ts`'s exported
  `verifyGrantAgainstAdmission` and its `VerifyOptions`
- Any consumer of `@changesafe/kubernetes-enforcer` other than the shipped
  `server.ts`/`main.ts` — this is a public library export, not an internal
  detail, so future integrators are as much the attack surface as the
  code shipped in this repo today

### Method

Found by external review (Codex, on PR #75); verified against the actual
signature and call sites rather than accepted on description.
`VerifyOptions.expectedResource` was optional (`?: string`), and the check
itself was `if (options.expectedResource !== undefined && grant.resource
!== options.expectedResource)` — with the default `options = {}`, calling
the exported function with no fifth argument at all skipped resource
verification entirely. Confirmed the one shipped caller
(`packages/kubernetes-enforcer/src/server.ts`) always supplied it via
`options.resolveExpectedResource`, so the shipped enforcer itself was never
exposed — the gap was in the public contract for any OTHER caller.

### Minimal reproducer

`packages/kubernetes-enforcer/tests/verify.test.ts`, "denies on resource
substitution" — calls `verifyGrantAgainstAdmission` with no options
argument at all and a grant naming a different resource than the admitted
object; confirmed to return `allowed: true` against the pre-fix optional
check and `allowed: false` against the fix.

### Expected invariant

A caller of the exported verification function cannot accidentally get a
weaker guarantee than the function's own documentation promises, by
omitting an option or simply not knowing it existed.

### Observed behavior

Any call to `verifyGrantAgainstAdmission` without `expectedResource` —
whether from a future integrator, a test, or a refactor that dropped the
option by accident — silently skipped resource verification while still
returning explicit ALLOW/DENY, indistinguishable from a fully-checked
result to the caller.

### Severity

Medium. Not reachable through the code shipped in this repo (the one real
caller always supplied the option), so this is a latent API-contract
defect rather than an exploited path — but for an open-source library
whose entire purpose is being embedded by third-party operators, an
optional security-relevant parameter that silently downgrades protection
when omitted is a real footgun, not a hypothetical one.

### Root cause

`expectedResource` was designed as an injectable option because deriving
it needs domain-specific logic (`@changesafe/domain-kubernetes`'s identity
resolution) that `verify.ts` didn't originally call directly — but
`verify.ts` already imports `canonicalizeAdmittedResource` from that same
package for the object hash, and that function already computes the
identity `resourceIdOf` needs. The dependency to derive it internally
already existed; it just wasn't used for this purpose.

### Fix

Removed `expectedResource` from `VerifyOptions` entirely.
`verifyGrantAgainstAdmission` now derives the expected resource directly
from `request.object` via `resourceIdOf(canonicalizeAdmittedResource(...).identity)`
— the same canonicalization the object-hash check already performs — making
the check unconditional rather than optional. This also let
`resolveExpectedResource` be removed from `EnforcerServerOptions`
(`server.ts`) and its wiring in `main.ts`: the injectable callback existed
only to do what `verify.ts` can now do itself.

The internal derivation can throw (an unsupported or malformed object) —
caught inside `verifyGrantAgainstAdmission` itself now, not left to the
caller, so the function's own documented "never throws" contract is
actually kept. `server.ts` previously caught this by coincidence, because
it called an equivalent `resolveExpectedResource` ahead of this function;
removing that parameter would have removed that incidental protection too
if the throw weren't handled internally — this was caught and fixed in the
same pass rather than shipped as a second regression.

### Regression test

`packages/kubernetes-enforcer/tests/verify.test.ts`'s "denies on resource
substitution" (see Minimal reproducer); `packages/kubernetes-enforcer/
tests/server.test.ts`'s "denies (200, not 500) when the admitted object
cannot be normalized" was rewritten to trigger the failure through a
genuinely unnormalizable admitted object (`object: null`, as a real DELETE
review carries) rather than simulating it via the now-removed injectable
callback, and still passes — confirming the internal try/catch covers what
the removed external one used to.

### What this changed in the architecture

`EnforcerServerOptions` lost one field (`resolveExpectedResource`);
`VerifyOptions` lost one field (`expectedResource`). No new dependency —
`verify.ts` already depended on `@changesafe/domain-kubernetes` for the
object hash and now uses one more export (`resourceIdOf`) from the same
package.

### Remaining uncertainty

Whether any other `VerifyOptions` field (`expectedPolicyVersion`) warrants
the same "derive it, don't trust a caller to supply it" treatment was not
evaluated — `expectedPolicyVersion` genuinely cannot be derived from the
admission request itself (it depends on which policy version is currently
active for the deployment), so it may be a legitimately different case,
but that distinction was not explicitly re-examined here.

## Finding CS-ADV-012

### Hypothesis

Both `ValidatingWebhookConfiguration`s intercept every operation the
enforcer's own verification logic supports, so a workload's admission is
never silently skipped for an operation the system claims to cover.

### Attack surface

- `examples/m2-kubernetes-enforcer/webhook-protected.yaml` and
  `webhook-default.yaml`'s `rules[].operations`

### Method

Found by external review (Codex, on PR #75); verified against Kubernetes'
own `ValidatingWebhookConfiguration` rule-matching contract (`operations`
is the exact set the webhook is invoked for, not a superset) and against
this repo's own code, not accepted on description: confirmed
`GrantOperationSchema` (`packages/core/src/grant.ts`) and
`AdmissionOperationSchema` (`packages/kubernetes-enforcer/src/
admission-review.ts`) both already include `CREATE`, and
`verifyGrantAgainstAdmission`'s operation comparison has no UPDATE-only
special-casing (`grep` for hardcoded `"UPDATE"` in
`packages/kubernetes-enforcer/src` found only the enum declaration itself)
— CREATE was fully supported in code and simply never routed to it.

### Minimal reproducer

`packages/kubernetes-enforcer/tests/verify.test.ts`, "allows a matching
CREATE grant and request" — confirms the verifier itself handles CREATE
correctly; the gap was routing, not verification logic, so this is a
positive-path confirmation rather than a failing-then-fixed reproducer
(there was nothing to fix in `verify.ts` — see Fix below).

### Expected invariant

Creating a brand-new protected-tier workload requires a valid grant, the
same as updating an existing one.

### Observed behavior

Both webhook configurations' `rules[].operations` listed only `["UPDATE"]`.
A CREATE admission request — a principal creating an entirely new
Deployment/StatefulSet/DaemonSet/Service — was never routed to the
enforcer at all, on either the protected or default tier, even while the
enforcer was fully healthy. Unlike `CS-ADV-006` (the `/scale` subresource
gap) and `CS-ADV-009` (the unprotected tier label), this gap required no
special exemption — the code to handle it already existed and worked; the
webhook manifests simply never asked Kubernetes to send it there.

### Severity

High. Reachable by anyone able to create a new resource of a
grant-protected kind in a protected namespace, with no privileged
identity, no grant tampering, and no need for the enforcer to be
unavailable — the webhook being perfectly healthy makes no difference.

### Root cause

The webhook manifests and their explanatory comments were written focused
on the UPDATE case (matching the milestone's demo, which scales an
existing Deployment) and the DELETE exclusion (which needed a real,
deliberate justification — `oldObject` handling doesn't exist yet). CREATE
fell through the gap between those two: unlike DELETE, nothing about it
needed special handling, so there was no explicit decision to leave it out
— it appears to have simply been overlooked rather than deliberately
deferred.

### Fix

Added `"CREATE"` to `rules[].operations` in both `webhook-protected.yaml`
and `webhook-default.yaml`, alongside `"UPDATE"`. No application code
changed — `verifyGrantAgainstAdmission` already handles a CREATE request
identically to an UPDATE one (compare operation, hash the admitted
object, no `oldObject` needed since CREATE has no prior state to diff
against).

### Regression test

`packages/kubernetes-enforcer/tests/verify.test.ts`'s new CREATE test (see
Minimal reproducer) — a positive-path confirmation, not a
fails-then-passes regression test, since the defect was in the YAML
routing configuration, which the unit suite cannot exercise (same
limitation as `CS-ADV-006`/`CS-ADV-009`).

### What this changed in the architecture

Nothing in application code. Two YAML manifests now register one more
already-supported operation.

### Remaining uncertainty

The kind-cluster demo transcript (`examples/m2-kubernetes-enforcer/
demo-transcript.txt`) only exercises UPDATE (scaling `spec.replicas`);
CREATE is now unit-tested and correctly routed per this fix, but has not
been exercised against a live cluster the way UPDATE was. Whether `CONNECT`
(the fourth operation `GrantOperationSchema`/`AdmissionOperationSchema`
both model) has an analogous routing gap was not checked — Kubernetes
issues CONNECT primarily for subresources like `exec`/`proxy`, which raises
questions similar to `CS-ADV-006`'s and was out of scope here.

### Amendment: the fix broke the demo's own bootstrap sequence

Found by a second round of the same external review, on the fix commit
itself. `examples/m2-kubernetes-enforcer/kind-repro.sh` registered both
webhook configurations, THEN applied the two baseline demo Deployments
with no grant attached, with a comment explicitly justifying this as safe:
"CREATE is not intercepted — only UPDATE/DELETE are, so bootstrapping
needs no grant." Registering CREATE (this finding's own fix) made that
comment wrong and, under `set -euo pipefail`, would have made the very
first `kubectl apply` in the script fail closed on the protected tier —
aborting the reproduction before any of the three demo steps ran.

Fixed by reordering: the two baseline Deployments are now created BEFORE
the webhook configurations are registered, matching how a real operator
would actually use this system — protecting an already-running resource
(the same model `K8S_PROTECTED_RESOURCE`'s own annotation uses), not
requiring a grant for a resource that never existed without one.
Namespace creation stays where it was (still needed before the Deployments
can target it); only the webhook registration itself moved, from before
the bootstrap Deployments to after. The stale comment was replaced with
one explaining why the new order is the realistic sequence, not a
workaround.

This reordering has NOT been re-run against a live kind cluster as part of
this fix (no cluster was available in the environment that made the
change) — verified only by reading the resulting script's structure and a
`bash -n` syntax check. The demo transcript recorded from the original
(pre-CS-ADV-012) kind run predates both the CREATE-routing fix and this
reordering, so it does not itself validate the new sequence either.
Re-running `kind-repro.sh` for real remains open follow-up work.

## Finding CS-ADV-013

### Hypothesis

Registering the Kubernetes domain in `packages/server/src/domains.ts`
(Task 3 of the M2 plan) makes the durable, authenticated HTTP review flow
— `POST /reviews` then `POST /reviews/:id/decisions`, the only route that
can issue a grant — actually reachable for a Kubernetes decision.

### Attack surface

- `features/reviews/durable-review-contract.ts`'s `DurableReviewDomainIdSchema`,
  `DurableReviewSourceSchema`, `HistoricalDurableReviewSourceSchema`, and
  both intake schemas' domain-schema branching
- `packages/server/src/durable-review-store.ts`'s SQLite row schemas and
  TypeScript types
- `packages/server/src/http.ts`'s `pendingReviewSession`'s `domainShape`
  classification

### Method

Found by external review (Codex, on PR #75); verified by reading the
actual schemas rather than accepted on description. Confirmed
`DurableReviewDomainIdSchema = z.enum(["network", "terraform"])` — a
hardcoded two-domain enum with no third branch — and that
`DurableReviewSourceSchema`/`HistoricalDurableReviewSourceSchema` are
`z.discriminatedUnion("domainId", [...])` with exactly those same two
literal branches, nothing else. Also checked `durable-review-store.ts`:
`domain_id: z.enum(["network", "terraform"])` is hardcoded in at least two
SQLite row schemas, plus the same literal union in several TypeScript type
declarations and `ListOptionsSchema`. Also checked `http.ts`'s
`pendingReviewSession`: `domainShape: network ? "simulated-state" :
"external-diff"` — a boolean ternary with no Kubernetes case, which would
misclassify Kubernetes as `external-diff` even if the schema gap above
were closed (Kubernetes is `simulated-state`, matching network, not
terraform).

### Minimal reproducer

Not directly unit-tested by this repo's existing suite, which is itself
the tell: `packages/server/tests/domains-kubernetes.test.ts` (Task 3's own
test) calls `resolveServerDomain("kubernetes")` directly, never through
`POST /reviews`. `tests/integration/m2-grant-issuance-to-enforcement.test.ts`
(this milestone's own composed issuance-to-verification test) calls
`DecisionService.decide()`/`issueGrant()` directly, also bypassing the
durable HTTP intake entirely. A reproducer would be: `POST /reviews` with
`domainId: "kubernetes"` — `DurableReviewIntakeSchema.parse` rejects it at
the schema boundary before `resolveServerDomain` is ever consulted.

### Expected invariant

Every domain `packages/server/src/domains.ts` registers is reachable
through every HTTP route the server advertises for durable review and
decision, not registered in one layer while gated out by an earlier one.

### Observed behavior

`POST /reviews` for a Kubernetes intake fails Zod validation immediately —
`domainId` is not `"network" | "terraform"`. `POST /reviews/:id/decisions`
can therefore never receive a pending Kubernetes review to decide, so it
can never issue a grant backed by a real Kubernetes decision through the
one HTTP route that issues grants at all. Every other piece of M2's
Kubernetes support (grant schema, signing, verification, the enforcer) is
real and tested; only the durable HTTP path that is supposed to connect a
human approval to a grant is unreachable for this domain.

### Severity

High. Not a security bypass — the opposite: a domain that cannot be
decided cannot be over-approved either — but it means the milestone's
central advertised flow ("an approver reviews and decides through
`changesafe serve`, and a grant is issued from that decision") does not
work for Kubernetes today via the real API, only via direct
`DecisionService` calls a caller would have to construct themselves,
bypassing durability, authentication, and the pending-review workflow
entirely.

### Root cause

`packages/server/src/domains.ts`'s `DOMAINS` registry (an internal lookup
table `resolveServerDomain` reads) and `features/reviews/
durable-review-contract.ts`'s `DurableReviewDomainIdSchema` (the HTTP
intake boundary's own, separately-maintained domain enum) are two
different sources of truth for "which domains does this server support,"
and only the first was updated when Kubernetes was added. Task 3's own
test (`domains-kubernetes.test.ts`) exercised only the first, so nothing
in that task's review surfaced the second, earlier gate.

### Fix

Not fixed in this pass — this is real design and implementation work, not
a schema enum widening:

1. `DurableReviewDomainIdSchema`, `DurableReviewSourceSchema`, and
   `HistoricalDurableReviewSourceSchema` all need a Kubernetes branch —
   including a real design decision for `sourceKind` and what a
   Kubernetes durable intake's `source` shape should record (the domain's
   own `KubernetesSnapshotProvenanceSchema` distinguishes `cluster-api`
   vs. `authored`, which does not map directly onto network's or
   terraform's `origin` vocabulary without a decision).
2. Both intake schemas' "content must satisfy its domain schema" branches
   are two-way ternaries (`network ? IncidentBundleSchema :
   TerraformInputSchema`) that would silently validate a `"kubernetes"`
   domainId against `TerraformInputSchema` if the enum were widened without
   also fixing this — a real bug waiting to happen, not just a missing
   case.
3. Kubernetes's proposal shape doesn't cleanly match either existing
   model: network requires an eagerly-submitted structured
   `NetworkChangeProposal`; terraform derives its diff from an immutable
   submitted plan with proposals forbidden entirely; Kubernetes derives
   its proposal from submitted manifest TEXT
   (`packages/server/src/domains.ts`'s `kubernetes.resolveProposal` calls
   `parseManifestDocuments(raw as string)`), a third shape this contract
   has never accounted for. Deciding how manifest text fits the intake
   envelope (as `input.content`? a new field?) is itself a design question.
4. `durable-review-store.ts`'s SQLite row schemas and TypeScript types
   hardcode the same two-domain enum in the persistence layer — widening
   this touches on-disk schema, which existing rows must remain readable
   against (this file already carries a historical-compatibility schema
   for exactly this kind of concern, so precedent exists, but it still
   needs doing correctly, not by pattern-matching quickly under review
   pressure).
5. `pendingReviewSession`'s `domainShape` ternary needs a real
   three-way (or domain-driven) classification, not a boolean.

Given the ledger consequences of getting a persisted-row schema wrong,
this needs its own careful pass, not a same-day PR-review patch.

### Regression test

None added in this pass — see Minimal reproducer for why the existing
suite doesn't already cover it, which is itself part of what this finding
documents.

### What this changed in the architecture

Nothing. This is a documented gap, not a code change.

### Remaining uncertainty

Whether `changesafe.dev`'s CLI (`changesafe gate`/`analyze`) is affected by
the same domain-shape question, or whether it has its own,
already-correct Kubernetes wiring independent of the durable HTTP
server's contract, was not checked. Whether the fix belongs in this
contract file at all, versus a broader refactor toward a single
domain-registry source of truth shared between `packages/server/src/
domains.ts` and `features/reviews/durable-review-contract.ts` so this
class of two-sources-of-truth gap cannot recur for a future domain, was
not evaluated — that broader question is exactly the kind of design
decision this finding defers rather than answers.

## Finding CS-ADV-014

### Hypothesis

An UPDATE grant binds the exact reviewed transition — the object's state
both before and after the approved change — not merely its target state.

### Attack surface

- `packages/kubernetes-enforcer/src/verify.ts`'s object-hash check
- `packages/core/src/grant.ts`'s `AuthorizationGrantSchema`

### Method

Found by external review (Codex, on PR #75); verified against the actual
verification logic rather than accepted on description — confirmed
`verifyGrantAgainstAdmission` computed and compared only
`kubernetesObjectSha256(request.object)` against `grant.objectSha256`,
with no reference anywhere to `request.oldObject` (which the schema at the
time did not even model).

### Minimal reproducer

`packages/kubernetes-enforcer/tests/verify.test.ts`, "denies replaying an
UPDATE grant against a diverged prior state (CS-ADV-014)" — issues a grant
for v1→v2, confirms it allows the reviewed v1→v2 transition, then confirms
it also (incorrectly, pre-fix) allowed a v3→v2 transition — an unreviewed
revert from a state the object had since diverged to. Verified this test
fails against the pre-fix code and passes against the fix.

### Expected invariant

A grant approving a specific reviewed transition cannot be replayed to
authorize a different, unreviewed transition that merely shares the same
target state.

### Observed behavior

A grant issued for a reviewed v1→v2 change remained valid for ANY
admission request whose `object` hashed to v2, regardless of what
`oldObject` was. If the resource diverged to an unreviewed v3 after grant
issuance (through any other change, reviewed or not), the same v1→v2
grant could still be presented to force the object from v3 back to v2 — a
v3→v2 transition nobody ever reviewed, disguised as the already-approved
v1→v2 one.

### Severity

Medium-High. Requires the object to have actually diverged from its
reviewed starting state before the grant is exercised (a real but not
trivial precondition — either a race with another legitimate change, or
an attacker able to make an intervening unreviewed change in the first
place, in which case they likely already have meaningful write access).
Where reachable, it lets a stale, still-valid grant force a resource back
to an old target state that is no longer the reviewed change it once was.

### Root cause

The grant's object binding was designed around "the target state a
decision approved," matching how a receipt records what an approved
proposal produces — but never accounted for the *starting* state the
decision was actually reviewed against. For CREATE this distinction does
not exist (there is no prior state); for UPDATE it does, and nothing
recorded it.

### Fix

`AuthorizationGrantSchema` gains an optional `oldObjectSha256`, mirroring
the `authorizedActorUid` pattern (`CS-ADV-008`): threaded through
`IssueGrantOptions` (`decisions.ts`) and `GrantRequestSchema` (`http.ts`).
`AdmissionRequestSchema` (`admission-review.ts`) gains an optional
`oldObject` field to actually carry Kubernetes' own `oldObject` through to
the verifier — it was silently dropped before (the schema was
`z.looseObject` so it passed through in principle, but nothing typed or
read it). `verifyGrantAgainstAdmission` now additionally hashes and
compares `request.oldObject` against `grant.oldObjectSha256` whenever the
grant supplies one.

Asymmetric like the uid-binding fix: whether this check applies is the
*issuer's* choice, not the request's — a grant issued with no
`oldObjectSha256` (CREATE, where there's no prior state, or an UPDATE
grant that didn't supply one) is unaffected, staying backward compatible
with the client-asserted binding model this whole issuance side already
has (`CS-ADV-004`) rather than making it mandatory and reopening that
larger, still-deferred design question.

### Regression test

`packages/kubernetes-enforcer/tests/verify.test.ts`'s new CS-ADV-014 test
(see Minimal reproducer) and a companion backward-compatibility test
confirming an UPDATE grant with no `oldObjectSha256` still allows,
matching by target state alone as before.

### What this changed in the architecture

`AuthorizationGrantSchema` and `AdmissionRequestSchema` each gained one
optional field. No new dependency, no change to the signing/
canonicalization scheme beyond the new field itself being part of what
gets signed.

### Remaining uncertainty

Like `CS-ADV-004`, `oldObjectSha256` is caller-asserted at issuance, not
server-derived from the receipt's actual before-state — a caller could in
principle supply an `oldObjectSha256` that doesn't correspond to what the
approved decision was actually reviewed against, which this fix does not
close. Whether the shipped demo (`kind-repro.sh`) or `main.ts`'s
production wiring should be updated to actually populate this field for
UPDATE grants was not done in this pass — the field exists and is
enforced when present, but nothing in this repository's own issuance path
currently supplies it yet.

### Amendment: optional was the wrong default for UPDATE

Found by a second round of the same external review, on the fix commit
itself. The first version made `oldObjectSha256` optional and asymmetric,
mirroring the `authorizedActorUid` pattern (`CS-ADV-008`) — but that
mirroring didn't actually transfer: `authorizedActorUid` is optional
because some identity providers genuinely never populate a stable uid,
a real environmental constraint. An UPDATE's prior state has no
equivalent excuse — every UPDATE has one by definition. Making it merely
optional meant the exact replay this finding exists to close remained
fully available to any caller who simply chose not to supply the field,
since nothing forced them to.

Fixed by making `AuthorizationGrantSchema`'s existing `superRefine` also
require `oldObjectSha256` whenever `operation === "UPDATE"` — not just in
`GrantRequestSchema` at the HTTP boundary, but in the schema every signed
grant is validated against on both sides (issuance via
`AuthorizationGrantSchema.parse`, and verification via `SignedGrantSchema`
embedding the same schema) — so no caller, present or future, can
construct or accept a well-formed UPDATE grant without it. CREATE remains
exempt, since it genuinely has no prior state to bind. This ripples into
every fixture across the test suite that builds an UPDATE grant, which
now all supply `oldObjectSha256`; each was updated. Regression test:
`packages/core/tests/grant.test.ts`, "rejects an UPDATE grant with no
oldObjectSha256 (CS-ADV-014 follow-up)" — verified to fail against the
optional (first-version) schema and pass against the fix.

### Amendment: three follow-on gaps in the oldObjectSha256 binding itself

Found by a third round of the same external review, on PR #75 after the
prior two amendments landed. All three were verified against the actual
code (not accepted on description) and each got a regression test proven
to fail pre-fix and pass post-fix.

**1. `deletionTimestamp`/`deletionGracePeriodSeconds` were excluded from
the grant's object hash.** `canonicalizeAdmittedResource`
(`packages/domain-kubernetes/src/normalize.ts`) treats server-owned
bookkeeping fields (`resourceVersion`, `managedFields`, ...) as excluded
from the hash a grant binds against, by design — the exclude-list shape is
deliberate so unknown future fields default to being hashed (safe
direction: extra false DENY, never false ALLOW). But
`deletionTimestamp`/`deletionGracePeriodSeconds` were folded into that same
exclude-list even though they are not server bookkeeping — they record
whether deletion has been *requested*, a lifecycle change that alters what
an UPDATE grant actually means. A grant reviewed against a not-yet-deleting
object (e.g. "remove this finalizer") stayed valid, unchanged, once that
object entered termination — and finalizer removal on a terminating object
triggers actual Kubernetes garbage collection, a materially different,
unreviewed outcome. Fixed by removing both keys from
`SERVER_OWNED_METADATA_KEYS`, so a deletion-lifecycle change now changes
the canonical hash like any other unreviewed drift. Regression test:
`packages/domain-kubernetes/tests/normalize.test.ts`, "changes canonical
output when deletion lifecycle state changes (CS-ADV-015)".

**2. A missing `oldObjectSha256` on an UPDATE grant request was only
caught after the decision was already committed.**
`AuthorizationGrantSchema.superRefine` (added in the prior amendment)
correctly rejects this — but that check runs inside `issueGrant`, called
from `packages/server/src/http.ts`'s decision route AFTER
`resolvePending()` has already ledgered the approval. A caller sending an
UPDATE grant request with no `oldObjectSha256` got the decision committed
to the ledger, and only then a 422 telling them the grant itself could not
be issued — an unrecoverable partial-success response, the same shape of
bug the existing `expiresAtUtc`/`MIN_GRANT_LIFETIME_MS` pre-ledger check
already exists to prevent for a different field. Fixed by adding the same
kind of pre-ledger check: `POST /reviews/:id/decisions` now rejects an
UPDATE grant request missing `oldObjectSha256` with 400 REQUEST_INVALID
before `resolvePending` runs. Verified pre-fix: the same request returned
422 (from `issueGrant`'s internal parse) with `ledger.count()` already
incremented — confirming the decision had committed before the caller
learned the grant request was invalid. Regression test:
`packages/server/tests/reviews.test.ts`, "refuses an UPDATE grant with no
oldObjectSha256 before anything reaches the ledger".

**2b. The same pre-ledger gap, for the inverse CREATE case.** Found in a
fourth round, directly on fix (2): once the core schema rejected
`oldObjectSha256` on CREATE (see 4 below), an approved CREATE decision
carrying one hit exactly the same sequence — `resolvePending` committed,
then `issueGrant`'s parse rejected the grant. Fixed by adding the
matching pre-ledger check for CREATE alongside the UPDATE one, so both
operation-dependent conditions are enforced at the request boundary
before the review resolves. Verified pre-fix: 422 with the decision
already ledgered. Regression test: `packages/server/tests/reviews.test.ts`,
"refuses a CREATE grant carrying oldObjectSha256 before anything reaches
the ledger".

**3. The kind-cluster demo never supplied `oldObjectSha256`.** The prior
amendment's "Remaining uncertainty" section already flagged this as
undone. `examples/m2-kubernetes-enforcer/kind-repro.sh`'s Demo step 1
built an UPDATE grant from `current`/`candidate` (the object fetched from
the live cluster and the same object with `replicas` bumped) but only ever
hashed `candidate` into `objectSha256`, leaving the grant's prior-state
binding entirely unexercised in the one place meant to demonstrate the
real enforcement path end to end. Fixed by hashing `current` (the
object's state *before* the reviewed replica change, fetched via `kubectl
get` before `candidate` is constructed) into a new `oldObjectSha256` field
on the grant, using the same `kubernetesObjectSha256` the enforcer itself
uses. Not independently regression-tested (the script drives a live kind
cluster this environment cannot run); verified by structural review
against `verifyGrantAgainstAdmission` (`packages/kubernetes-enforcer/src/
verify.ts`), which already compares `request.oldObject`'s hash against
`grant.oldObjectSha256` whenever present, and by `bash -n` syntax check.

None of these three change `AuthorizationGrantSchema`'s shape or
`policyVersion` — no version bump. (1) changes what
`canonicalizeAdmittedResource` includes in its hash, not the grant schema
itself, so it needed no policy version bump either: it is a normalization
fix, not a policy behavior change.

## Finding CS-ADV-016

### Hypothesis

An UPDATE grant binds the specific resource *incarnation* that was
reviewed, not merely a resource name whose current state happens to match.

### Attack surface

- `packages/domain-kubernetes/src/normalize.ts`'s
  `SERVER_OWNED_METADATA_KEYS` (excludes `uid` from the grant object hash)
- `packages/kubernetes-enforcer/src/verify.ts`'s binding checks
- `packages/core/src/grant.ts`'s `AuthorizationGrantSchema`

### Method

Found by external review (Codex, on PR #75, the round after `CS-ADV-015`).
Verified against the code rather than accepted on description: `uid` is in
the exclude-list, so two objects differing only in `metadata.uid`
canonicalize identically; nothing else in the grant or the verifier
referenced a uid for the *resource* (only `authorizedActorUid` exists, for
the actor).

### Minimal reproducer

`packages/kubernetes-enforcer/tests/verify.test.ts`, "denies replaying an
UPDATE grant against a recreated incarnation of the same resource
(CS-ADV-016)" — asserts first that the original and a recreated object
(same name, same spec, different uid) hash identically, then that a grant
issued for the original allows against it and is refused against the
recreation. Verified to fail against the pre-fix code.

### Expected invariant

A grant issued against one object cannot authorize a transition on a
different object that merely reuses its name.

### Observed behavior

Delete `web`, recreate `web` with the same spec, and a still-valid UPDATE
grant for the original authorized the same transition on the replacement:
`resource` (kind/namespace/name) matched, `objectSha256` matched, and —
because the prior-state hash excludes `uid` too — `oldObjectSha256`
matched as well. Nothing in the grant distinguished the two incarnations.

### Severity

Medium. Exploiting it needs a same-name recreation inside the grant's
validity window; in a protected namespace that recreation itself needs a
CREATE grant (DELETE is not webhook-registered, so deletion is free). So
the realistic shape is a *reviewed* recreate followed by a *stale* UPDATE
grant being replayed onto it — a transition nobody reviewed on that
object, and the same class of name-vs-identity confusion `CS-ADV-008`
closed for actors.

### Root cause

`uid` was excluded from the object hash deliberately and correctly: a
CREATE grant is issued before the object exists, so its uid is unknowable
at issuance and cannot be part of a hash the issuer must precompute. But
that exclusion was never compensated for on UPDATE, where the incarnation
does exist and does have a stable identity to bind.

### Fix

Codex offered two shapes — put `uid` back into the hash for UPDATE, or
carry it as a separately verified grant field. The second is taken,
mirroring `authorizedActorUid`/`oldObjectSha256`: `AuthorizationGrantSchema`
gains `resourceUid`, required for UPDATE and rejected for CREATE (both in
the schema's `superRefine`, so issuance and verification share it), and
`verifyGrantAgainstAdmission` compares it against
`request.oldObject.metadata.uid` — the incarnation actually being changed,
read via a never-throwing accessor so the function keeps its no-throw
contract; a missing or non-string uid is refused, not waved through. Hash
semantics are unchanged, which keeps CREATE hashing precomputable.
Threaded through `IssueGrantOptions`, `GrantRequestSchema`, and — applying
today's own lesson from the `CS-ADV-014` amendments directly — both
pre-ledger checks in `POST /reviews/:id/decisions`, so neither condition
is first discovered after the decision commits. `kind-repro.sh` supplies
`current.metadata.uid`.

### Regression test

The reproducer above, plus `packages/core/tests/grant.test.ts` (UPDATE
without / CREATE with `resourceUid` both rejected) and
`packages/server/tests/reviews.test.ts` (both pre-ledger refusals, each
verified pre-fix to return 422 with the decision already ledgered).

### What this changed in the architecture

One new optional-in-shape, required-by-operation field on
`AuthorizationGrantSchema`, opaque to core. Every UPDATE fixture in the
suite now carries a uid on its prior object and `resourceUid` on its
grant. No hash or `policyVersion` change.

### Remaining uncertainty

Like every binding field on the issuance side, `resourceUid` is
caller-asserted (`CS-ADV-004`). And the grant schema is meant to be
domain-agnostic; "an existing resource always has a stable uid" is true of
Kubernetes and of every enforcement boundary currently contemplated, but a
future domain without such an identifier would need this requirement
revisited rather than worked around with a placeholder value.

## Finding CS-ADV-017

### Hypothesis

A deployed enforcer always holds grants to the active policy version; a
grant issued under an obsolete policy set cannot be admitted after an
upgrade merely because its signing key and expiry survived it.

### Attack surface

- `packages/kubernetes-enforcer/src/main.ts` (reads `EXPECTED_POLICY_VERSION`)
- `examples/m2-kubernetes-enforcer/enforcer-deployment.yaml` (leaves it unset)
- `packages/kubernetes-enforcer/src/verify.ts` (skips the drift comparison
  when no expectation is supplied)

### Method

Found by external review (Codex, on PR #75). Verified against the code:
`main.ts` passed `process.env.EXPECTED_POLICY_VERSION` straight through
with no default, the shipped Deployment deliberately omitted it, and the
verifier's drift branch is guarded by `options.expectedPolicyVersion !==
undefined`. The unit suite exercised only the opt-in branch.

### Minimal reproducer

No single test reproduces the deployment-level gap, since it lives in
how the entrypoint is configured rather than in any function's logic.
The closest proof is structural: `main.ts` resolved `undefined` from an
unset environment, and `verify.test.ts`'s drift test only ever passes an
explicit expectation. The fix's regression tests (below) pin the new
resolution behaviour.

### Expected invariant

The policy-version-drift check runs on every admission decision. Binding
it is not something a deployment can decline by omission.

### Observed behavior

With the shipped manifest, the enforcer ran with the drift check off. Any
grant signed by a still-trusted key and not yet expired was admissible
regardless of which policy set had produced its receipt — so a policy
upgrade that tightened a rule did not invalidate grants already issued
under the looser one for as long as those grants lived.

### Severity

Medium-High. Bounded by grant lifetime and by the signing key not being
rotated at upgrade time; unbounded in the sense that nothing in the
shipped configuration would ever have caught it, and the comments framed
the omission as a harmless demo simplification.

### Root cause

The drift check was designed as opt-in so the demo would not be pinned to
one composed version string. That framing treated the check as a
nice-to-have rather than part of the invariant, and the deployment
manifest inherited the omission as if it were the recommended setting.

### Fix

`resolveExpectedPolicyVersion(env)` in `server.ts`: `EXPECTED_POLICY_VERSION`
is now an *override*; absent or empty, the enforcer binds to the
`POLICY_VERSION` bundled in `@changesafe/domain-kubernetes` — the image
is built from the same checkout as the policies it guards, so that
constant is the active policy set by construction. `main.ts` uses it and
logs the bound version at startup. The library-level option stays
optional so tests can exercise both branches; only the runnable
entrypoint loses the ability to run unbound. The Deployment comment,
`kind-repro.sh`, and `docs/M2_TECHNICAL_NOTE.md` are rewritten to say the
check is live (the demo grant already carries the same `POLICY_VERSION`,
so the kind run still passes); the recorded transcript is noted as
predating this.

### Regression test

`packages/kubernetes-enforcer/tests/server.test.ts`,
"resolveExpectedPolicyVersion (CS-ADV-017)": absent env → bundled
version; empty string → bundled version; explicit override honoured; and
no input resolves to a value the verifier would read as "skip".

### What this changed in the architecture

`@changesafe/kubernetes-enforcer` already depended on
`@changesafe/domain-kubernetes`; it now imports `POLICY_VERSION` from it.
No schema or hash change.

### Remaining uncertainty

Binding to the bundled constant assumes the enforcer image is rebuilt
when policies change. An operator who upgrades the decision server's
policies but keeps running an older enforcer image gets the *opposite*
failure — new grants denied as drifted — which is the safe direction, and
the startup log line makes the bound version visible, but it is still an
operational coupling worth stating in deployment docs when those exist.
