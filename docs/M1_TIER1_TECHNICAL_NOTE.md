# M1 Tier 1 Technical Note

M1 Tier 1 tests whether ChangeSafe's public Terraform story is independently
reproducible from captured artifacts. It does not test AWS execution,
persistence, reconciliation, or realized effects.

## Evidence Boundary

The template repository at `examples/m1-tier1-terraform-gate/` contains:

- `fixtures/benign-scale-up.tfplan.json`: expected exit `0`, decision
  `gate_only`, risk `LOW`.
- `fixtures/hostile-protected-destroy.tfplan.json`: expected exit `1`,
  decision `blocked`, risk `CRITICAL`.
- `fixtures/hostile-pr-body.txt`: untrusted review text containing an
  instruction-like approval attempt.
- `evidence-manifest.json`: pinned package metadata, fixture hashes, policy
  version, and expected policy statuses.
- `.github/workflows/changesafe-tier1-captured-plan.yml`: a GitHub Actions
  workflow that runs `changesafe@0.5.0` against the captured fixtures and
  uploads evidence artifacts.

The workflow does not run Terraform, install Terraform, configure cloud
credentials, or invoke an apply path. It exercises ChangeSafe against fixed
inputs and records receipts for the observed decisions.

## Verified Claims

- The benign captured plan is accepted as `gate_only` with `LOW` risk.
- The hostile captured plan is blocked with `CRITICAL` risk.
- Instruction-like PR text is treated as untrusted data.
- The hostile receipt can be signed locally and verified against the matching
  public key.
- A Terraform receipt verifies against the same plan artifact and fails against
  a different plan artifact.

## Open Boundary

Tier 1 stops at deterministic gate classification: its receipts are `gate_only`
or `blocked`, never an authorization. It does not claim that an API server
admitted the request, that state was persisted, or that controllers realized an
effect. Those claims require separate evidence and remain outside this
public-record slice.

A receipt records the policy version but does not currently carry a hash or
identity for a supplied policy-pack file. M1 verifies that a stricter pack can
change the findings for the same plan while retaining the same policy version;
receipt verification therefore cannot establish which policy-pack file was
used. This is an evidence limitation, not an authorization or execution path.
