# M1 Tier 2 Evidence Checklist

Fill this file during the author-run AWS sandbox exercise. Tier 2 is a
real-world demonstration required of the project author, not of reviewers;
the external-reproduction condition applies only to Tier 1. Keep receipts and
logs as run outputs under `evidence/` (gitignored); transcribe hashes and
verdicts here. Never record credentials, account secrets, or raw state
contents.

## Fixed Inputs

| Field | Value |
| --- | --- |
| Package | `changesafe@0.5.0` |
| npm integrity | `sha512-/0Fc69/BrZphQ4VbWk+1utkSLTdqD8AtAMop2xVCUCEu52lTAr32mUYM407w63TaTCVvGKgqMCYgZChbKgl6/Q==` |
| Expected policy version | `core-v0.2.0+terraform-v0.2.0` |
| Hostile PR body SHA-256 | `0aaad1bae1c281c057c6b8f64d6d27399a907d473f7ef3ea2bedfa4424f19580` |

## Environment Record

| Field | Value |
| --- | --- |
| Date (UTC) | _fill in_ |
| AWS account | _sandbox alias or last 4 digits only_ |
| Region | _fill in_ |
| Terraform version | _from `evidence/terraform-version.json`_ |
| Baseline state SHA-256 | _from `evidence/baseline-state.sha256`_ |

## Benign Path (PASS → operator apply)

| Field | Value |
| --- | --- |
| Captured plan SHA-256 | _from `evidence/benign.tfplan.json.sha256`_ |
| Gate exit code | _expect 0_ |
| Receipt SHA-256 | _hash of `evidence/benign.receipt.json`_ |
| Receipt decision | _expect `gate_only`_ |
| Receipt risk level | _expect `LOW`_ |
| Receipt policy version | _expect `core-v0.2.0+terraform-v0.2.0`_ |
| Apply log | `evidence/benign-apply.log` |
| Resources changed (operator-observed) | _e.g. `aws_ssm_parameter.demo` updated in place_ |
| Post-apply state SHA-256 | _from `evidence/benign-post-apply-state.sha256`_ |

## Hostile Path (BLOCK → apply never reached)

| Field | Value |
| --- | --- |
| Captured plan SHA-256 | _from `evidence/hostile.tfplan.json.sha256`_ |
| Gate exit code | _expect 1_ |
| Receipt SHA-256 | _hash of `evidence/hostile.receipt.json`_ |
| Receipt decision | _expect `blocked`_ |
| Receipt risk level | _expect `CRITICAL`_ |
| Pre-phase state SHA-256 | _from `evidence/hostile-pre-state.sha256`_ |
| Post-phase state SHA-256 | _from `evidence/hostile-post-state.sha256`; must equal pre_ |
| Blocked plan artifact | _deleted by the harness after the BLOCK_ |
| Signer public key id | _from `evidence/hostile-keygen.json`_ |
| Signature verification verdict | _from `evidence/hostile-verify.json`; expect `valid`_ |

## Boundary Notes

- ChangeSafe never ran Terraform in either path. The operator's harness ran
  `plan`, `show -json`, and — on the benign path only, after the gate exited
  0 — `apply` of the same saved plan the gate read.
- The benign receipt records `gate_only`: what the deterministic policies
  found in the captured plan artifact. It is not an approval, and it does not
  attest the apply outcome. The apply result above is operator-observed
  evidence, recorded separately from the receipt on purpose.
- The gate's verdict is about the authorized proposal (E0). What the AWS API
  admitted, persisted, or reconciled after the operator's apply is a
  different stage; binding those stages together is M2's question, not a
  Tier 2 claim.
- The hostile "apply never occurred" claim rests on three operator-side
  facts: the harness has no apply statement after the hostile gate call, the
  blocked plan artifact was deleted, and the state hash was identical before
  and after the phase.
- The PR body is untrusted text. The gate scans it as data and never follows
  instructions inside it.
