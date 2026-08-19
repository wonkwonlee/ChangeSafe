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
