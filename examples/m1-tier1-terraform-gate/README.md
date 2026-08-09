# M1 Tier 1 Terraform Gate Reproduction

This template exercises ChangeSafe against captured `terraform show -json`
artifacts. It needs no cloud credentials and performs no infrastructure
operation. The gate reads the checked-in plan JSON, records a keyless receipt,
and exits with the deterministic verdict. The hostile path additionally signs
the BLOCK receipt with an ephemeral local key and verifies it against the
matching public key.

The two fixtures are intentionally small:

- `fixtures/benign-scale-up.tfplan.json` exits `0`, records `gate_only`, and
  has risk `LOW`.
- `fixtures/hostile-protected-destroy.tfplan.json` plus
  `fixtures/hostile-pr-body.txt` exits `1`, records `blocked`, and has risk
  `CRITICAL`.

The npm package is pinned to `changesafe@0.5.0` in both commands and the
workflow. The package metadata and fixture hashes are recorded in
`evidence-manifest.json`; run-specific receipt hashes and the template commit
belong in `M1_EVIDENCE.md` after a reproduction run.

## Local Commands

```bash
npx --yes changesafe@0.5.0 gate \
  --domain terraform \
  --input fixtures/benign-scale-up.tfplan.json \
  --receipt evidence/benign.receipt.json \
  --format json
```

```bash
key_dir="$(mktemp -d)"
trap 'rm -rf "$key_dir"' EXIT
mkdir -p evidence
npx --yes changesafe@0.5.0 keygen \
  --out "$key_dir/hostile-signing-key" \
  --format json > evidence/hostile-keygen.json

set +e
npx --yes changesafe@0.5.0 gate \
  --domain terraform \
  --input fixtures/hostile-protected-destroy.tfplan.json \
  --context fixtures/hostile-pr-body.txt \
  --receipt evidence/hostile.receipt.json \
  --sign-key "$key_dir/hostile-signing-key.pem" \
  --format json
code="$?"
set -e
test "$code" -eq 1

cp "$key_dir/hostile-signing-key.pub.pem" evidence/hostile-signing-key.pub.pem
npx --yes changesafe@0.5.0 verify evidence/hostile.receipt.json \
  --public-key evidence/hostile-signing-key.pub.pem \
  --format json
```

## GitHub Actions

Copy `.github/workflows/changesafe-tier1-captured-plan.yml` into a template
repository that contains these fixtures. The workflow checks out the repository,
sets up Node, runs the pinned npm package, uploads receipts, and asserts the
expected benign and hostile verdicts. The hostile job keeps the private signing
key in runner temp storage, uploads only the public key, and verifies the signed
receipt before artifact upload.

A clean gate is not an approval. A receipt records what artifact the gate saw
and what deterministic policies found; it does not prove a later infrastructure
effect. The hostile signature verification checks receipt integrity and signer
authenticity. The plan and PR-body fixture hashes are recorded separately in
`evidence-manifest.json`.
