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
