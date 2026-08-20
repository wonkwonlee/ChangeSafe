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
