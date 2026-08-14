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
| Date (UTC) | 2026-08-14 |
| AWS account | ...9679 (IAM user `changesafe-tier2-sandbox`, scoped policy) |
| Region | us-east-2 |
| Terraform version | 1.15.8 (`hashicorp/aws` 6.60.0) |
| Baseline state SHA-256 | `bcaa6e97a0ac65aa9cbbfb1c170ce3e6ef40c1dc7ee8d6708e328ed82ab93483` |

## Benign Path (PASS → operator apply)

| Field | Value |
| --- | --- |
| Captured plan SHA-256 | `ab4c6421cea4de3c7aa4df699374d7f1dbca48142d01e301c19b194285318d03` |
| Gate exit code | 0 |
| Receipt SHA-256 | `6b455bede7c083dfed0aafb31e14b7258c0ce1fe6c7724e19c329db5538b89a1` |
| Receipt decision | `gate_only` |
| Receipt risk level | `LOW` |
| Receipt policy version | `core-v0.2.0+terraform-v0.2.0` |
| Apply log | `evidence/benign-apply.log` |
| Resources changed (operator-observed) | `aws_ssm_parameter.demo` updated in place (1 changed, 0 added, 0 destroyed) |
| Post-apply state SHA-256 | `7df4d7adda44086d0c406d10cc3e3028bfe04177d2c879e9b88ad1b3fe35205a` |

## Hostile Path (BLOCK → apply never reached)

| Field | Value |
| --- | --- |
| Captured plan SHA-256 | `4c916325c4117854224603ffd4d3335a0a0f6477258faf7453d171f9e89b8fe8` |
| Gate exit code | 1 |
| Receipt SHA-256 | `4fdccf89c7e1cb97343c6b7267f6bd3f2e813239782ee4d674f6238d9311aed6` |
| Receipt decision | `blocked` |
| Receipt risk level | `CRITICAL` |
| Pre-phase state SHA-256 (informational) | `349bba5026bb1209dab0c4c76ce19a7831d750f20d8a49fa9f9c0c50e3619d6f` |
| Post-phase state SHA-256 (informational) | `7df4d7adda44086d0c406d10cc3e3028bfe04177d2c879e9b88ad1b3fe35205a` (equals the benign post-apply state — the hostile phase left the real estate untouched) |
| Post-BLOCK baseline plan exit code | 0 (no pending changes) |
| Post-BLOCK baseline plan log | `evidence/hostile-post-plan.log` — "No changes. Your infrastructure matches the configuration." |
| Blocked plan artifact | deleted by the harness after the BLOCK |
| Signer public key id | `e2bc455f43b35b85a71668b43c59ea5a` |
| Signature verification verdict | `valid` (receipt hash check: ok; signature check: ok) |

## Boundary Notes

- ChangeSafe never ran Terraform in either path, and neither does
  `run-tier2.sh` itself (safety invariant #1, `AGENTS.md`): it plans,
  captures `show -json`, gates, and reads state, but on the benign path it
  only ever prints the exact saved plan for the operator to apply — the
  operator ran that printed command by hand under their own credentials.
  This specific run predates that harness revision, in which the script
  applied the plan directly instead of printing it; the operator's own
  credentials executed it either way, and no policy or verdict depends on
  who typed the command.
- The benign receipt records `gate_only`: what the deterministic policies
  found in the captured plan artifact. It is not an approval, and it does not
  attest the apply outcome. The apply result above is operator-observed
  evidence, recorded separately from the receipt on purpose.
- The gate's verdict is about the authorized proposal (E0). What the AWS API
  admitted, persisted, or reconciled after the operator's apply is a
  different stage; binding those stages together is M2's question, not a
  Tier 2 claim.
- The hostile "apply never occurred" claim rests on three operator-side
  facts: `run-tier2.sh` contains no apply statement, printed or otherwise,
  anywhere in its hostile phase, the blocked plan artifact was deleted, and a
  follow-up plan against the untouched baseline variables
  (`-refresh=false -detailed-exitcode`) showed zero pending changes. The
  pre/post whole-state hashes are recorded for reference only — a
  local-backend `plan` can rewrite refreshed metadata into the state file
  even with nothing applied, so raw hash equality is not used as the proof
  here.
- The PR body is untrusted text. The gate scans it as data and never follows
  instructions inside it.
