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
