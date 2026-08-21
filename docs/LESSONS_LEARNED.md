# Lessons Learned

## M1 Tier 1: Reproduction needs a narrow evidence boundary

M1 Tier 1 is useful only if a reviewer can reproduce the claimed gate behavior
without cloud credentials, Terraform execution, or repository authority beyond a
copied template. The checked-in template under
`examples/m1-tier1-terraform-gate/` makes that boundary explicit:

- The inputs are captured `terraform show -json` fixtures and one PR-body text
  fixture.
- The package is pinned to `changesafe@0.5.0`.
- The evidence manifest records release metadata, policy version, expected
  verdicts, and fixture hashes.
- The workflow records receipts and verifies the hostile signed receipt, but it
  does not apply infrastructure changes.

The main lesson is vocabulary discipline. A clean Terraform gate can say what
the deterministic policies found in a captured plan artifact; a `gate_only`
receipt is not an authorization. It cannot say what a cloud API admitted,
persisted, or reconciled. Keeping that gap visible makes the next milestone
question sharper instead of letting Tier 1 overclaim.

This lesson is backed by `CS-ADV-001`, which found no counterexample under the
captured-plan attack model but left Tier 2 and M2 questions open.

## M1 close-out: a milestone's scope also has to answer for the last one's

M0's private review produced ten attack hypotheses. M1 was scoped to the
Terraform benign/hostile control flow only, so most of those hypotheses were
never going to be M1's job — some named Kubernetes, some named the public
app workbench, neither of which M1 touches. The mistake that scoping makes
easy is letting "out of scope" quietly become "forgotten."

Closing M1 required walking every M0 hypothesis to an explicit disposition:
resolved in Terraform scope (`CS-ADV-001`, `CS-ADV-002`), resolved only for
the Terraform channel of a broader hypothesis, or correctly deferred to a
future Kubernetes- or app-track milestone. `CS-ADV-002` in particular
surfaced a real residual gap even inside Terraform scope — a receipt's
`policyVersion` does not identify the policy-pack file that produced its
findings — and that gap is carried forward rather than closed by definition.

The lesson: a milestone's exit gate is not just "did we find and fix
something," it's "did every open question from the milestone that fed this
one get an answer, even if the answer is 'still open, deferred on purpose.'"
Silent deferral and quiet forgetting look identical from the outside; only a
written disposition tells them apart.

## M2: `objectSelector` cannot match an annotation — resolved empirically, not architecturally

The M2 design spec deliberately left "how does a grant physically reach the
webhook" as an implementation-time experiment against a real kind cluster
rather than deciding it on paper, on the grounds that Kubernetes' admission
API shape constrains the answer more than architecture preference does. The
first candidate design assumed a `changesafe.dev/protected: "true"`
annotation could route requests to the protected-tier webhook via
`objectSelector`. Only running against a real API server surfaced that
Kubernetes' `objectSelector` matches labels, not annotations — no amount of
design review would have caught this, because it isn't a ChangeSafe design
question at all, it's a property of the platform being integrated with.

The considered alternative — a mutating controller mirroring the annotation
onto a label — was rejected specifically because it would have added a
second running component with its own failure mode, which is exactly the
kind of complexity this milestone exists to reason precisely about rather
than accumulate. The resolution instead routes by **namespace**, using
`namespaceSelector` (a real Kubernetes selector target for namespace
labels, not a workaround): a cluster operator labels which namespaces hold
protected resources, and the protected/default webhook split follows that
label. This is a genuine tradeoff, not a strictly better answer — it moves
the protected/default distinction from "per-object, inferred from
annotation" to "per-namespace, an operator convention" — and it is
documented as such in both the webhook YAML comments and
`examples/m2-kubernetes-enforcer/README.md`.

The same kind-cluster run surfaced two more platform facts no unit test
could have: the admission webhook client appends its own `?timeout=10s`
query string to the configured path, which an exact-equality path check
silently rejected as 404; and TLS certs generated with an Ed25519 key
failed handshake against the test client's TLS stack, requiring RSA 2048
for the TLS layer (kept separate from the Ed25519 grant-signing key, which
is a distinct concern). None of these were library or logic bugs in
ChangeSafe's own code — they were assumptions about the platform that only
a live cluster could falsify. The lesson repeats M1's: a reproduction that
never leaves unit tests and hand-written fixtures cannot find the platform
facts that only running against the real thing reveals.
