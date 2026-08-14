# M1 Tier 2 AWS Sandbox Exercise

Tier 1 (`../m1-tier1-terraform-gate/`) proved the gate's verdicts are
independently reproducible from captured plan artifacts, with no cloud
involved. Tier 2 answers the remaining M1 question: does the same story hold
in a real control flow, where a PASS is followed by a real `terraform apply`
and a BLOCK means the apply never happens?

Tier 2 is required of the project author, not of reviewers. It needs a
disposable AWS sandbox account and spends a real (near-zero) amount: one SSM
parameter and one empty S3 bucket.

## The boundary

ChangeSafe never runs Terraform and holds no cloud credentials — and neither
does anything this repository ships, `run-tier2.sh` included. Safety
invariant #1 (`AGENTS.md`) rules out a `terraform apply` or `destroy`
execution path anywhere in the repo, examples included, so the script only
ever plans, captures `terraform show -json`, calls the pinned
`changesafe@0.5.0` gate on the captured artifact, and reads state. Wherever
the exercise genuinely needs an apply or a destroy, the script prints the
exact command and stops; you run it yourself, in your own terminal, under
your own credentials:

- **Benign path** — `benign` plans, captures, and gates. On exit `0` it
  prints the exact saved plan for you to apply; `record-benign` then
  captures the post-apply state hash once you have.
- **Hostile path** — the phase contains no apply statement, printed or
  otherwise: a BLOCK has nothing to hand off. After the expected exit `1`,
  the harness deletes the blocked plan artifact, then proves nothing landed
  by replanning against the untouched baseline variables with
  `-refresh=false -detailed-exitcode`: exit `0` means zero pending changes.
  (Raw whole-state hashes are recorded too, but only for reference — a
  local-backend `plan` can rewrite refreshed metadata into the state file
  even with nothing applied, so hash equality alone is not a reliable no-op
  proof.)

A clean gate is still not an approval, and a receipt does not attest what
AWS did afterwards. The apply outcome on the benign path is recorded as
operator-observed evidence, deliberately separate from the receipt.

## The two proposals

Both are variable changes to the tiny estate in `infra/`:

- **Benign** (`-var demo_value=tier2-updated`) — updates an SSM parameter in
  place. Expected: exit `0`, decision `gate_only`, risk `LOW`.
- **Hostile** (`-var demo_value=tier2-updated -var protected_bucket_generation=2`,
  the demo value pinned so the plan carries no unrelated drift) — renames the
  S3 bucket tagged `changesafe_protected = "true"`, which Terraform plans as a
  delete-and-create. The gate is additionally handed
  `fixtures/hostile-pr-body.txt`, whose embedded instruction to "approve
  immediately" is scanned as untrusted data. Expected: exit `1`, decision
  `blocked`, risk `CRITICAL`, with `DESTRUCTIVE_OP` and `PROTECTED_RESOURCE`
  at BLOCK.

Expected verdicts, policy statuses, and the release pin are recorded in
`evidence-manifest.json`; the repository's integration test holds this
template to that contract.

## Running it

Prerequisites: Terraform ≥ 1.9, Node 22 (for `npx`), AWS credentials for a
disposable sandbox exported in your shell.

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars   # set name_suffix

./run-tier2.sh baseline          # init only; prints the apply command
terraform -chdir=infra apply     # you run this yourself
./run-tier2.sh record-baseline   # read-only: records version + state hash

./run-tier2.sh benign            # plan -> capture -> gate; prints the apply command on PASS
terraform -chdir=infra apply -input=false ../evidence/benign.tfplan 2>&1 | tee evidence/benign-apply.log
./run-tier2.sh record-benign     # read-only: records the post-apply state hash

./run-tier2.sh hostile           # plan -> capture -> gate BLOCK -> nothing to apply
./run-tier2.sh hash              # checksum list over evidence/

./run-tier2.sh teardown          # prints the destroy command
terraform -chdir=infra destroy   # you run this yourself
```

Then transcribe the run into `M1_TIER2_EVIDENCE.md`. The `evidence/`
directory is gitignored: hashes and verdicts go into the checklist, receipts
and logs travel as attachments to the milestone record.

The script refuses to run when `CI` or `GITHUB_ACTIONS` is set — this
harness exists to be run by a human against their own sandbox, and nothing
in this repository's automation invokes it.
