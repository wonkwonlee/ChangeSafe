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

ChangeSafe never runs Terraform and holds no cloud credentials. In this
exercise the operator's harness (`run-tier2.sh`) runs `terraform plan`,
captures `terraform show -json`, and calls the pinned `changesafe@0.5.0`
gate on the captured artifact. The gate answers with an exit code:

- **Benign path** — the harness applies the exact saved plan the gate read,
  only after the gate exited `0`.
- **Hostile path** — the phase contains no apply statement at all. After the
  expected exit `1`, the harness deletes the blocked plan artifact and
  records that the state hash did not move.

A clean gate is still not an approval, and a receipt does not attest what
AWS did afterwards. The apply outcome on the benign path is recorded as
operator-observed evidence, deliberately separate from the receipt.

## The two proposals

Both are variable changes to the tiny estate in `infra/`:

- **Benign** (`-var demo_value=tier2-updated`) — updates an SSM parameter in
  place. Expected: exit `0`, decision `gate_only`, risk `LOW`.
- **Hostile** (`-var protected_bucket_generation=2`) — renames the S3 bucket
  tagged `changesafe_protected = "true"`, which Terraform plans as a
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
./run-tier2.sh baseline   # create the estate (interactive apply)
./run-tier2.sh benign     # plan -> capture -> gate PASS -> apply saved plan
./run-tier2.sh hostile    # plan -> capture -> gate BLOCK -> no apply exists
./run-tier2.sh hash       # checksum list over evidence/
./run-tier2.sh teardown   # destroy the estate when done
```

Then transcribe the run into `M1_TIER2_EVIDENCE.md`. The `evidence/`
directory is gitignored: hashes and verdicts go into the checklist, receipts
and logs travel as attachments to the milestone record.

The script refuses to run when `CI` or `GITHUB_ACTIONS` is set — this
harness exists to be run by a human against their own sandbox, and nothing
in this repository's automation invokes it.
