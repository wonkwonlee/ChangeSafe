#!/usr/bin/env bash
# M1 Tier 2 operator harness.
#
# This script is the *operator's* pipeline, not part of ChangeSafe. Terraform
# runs under the operator's own credentials; ChangeSafe only ever reads the
# captured `terraform show -json` artifact and answers with an exit code.
# The benign apply below is reachable only through that exit code; the
# hostile phase contains no apply at all, so a BLOCK verdict has nothing to
# fall through to.
#
# Tier 2 is required of the project author, not of reviewers. Do not run it
# in CI, and do not run it against an account holding anything you care
# about — use a disposable sandbox account.
#
# Usage: ./run-tier2.sh <baseline|benign|hostile|teardown|hash>

set -euo pipefail

if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "run-tier2.sh is an operator-run harness and refuses to run in CI." >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$HERE/infra"
EVIDENCE="$HERE/evidence"

# Every path this script mktemp's gets removed here, and only here — see
# the comment on NPX_CWD below for why a single top-level trap replaced the
# earlier per-function ones.
CLEANUP_PATHS=()
cleanup() {
  local path
  for path in "${CLEANUP_PATHS[@]:-}"; do
    [ -n "$path" ] && rm -rf "$path"
  done
}
trap cleanup EXIT

# npx's bare-command resolution checks an enclosing project's
# node_modules/.bin before it consults --package, even when --package names
# an exact version: run this script from inside this monorepo (which builds
# its own `changesafe` workspace binary at node_modules/.bin/changesafe) and
# every "pinned npm release" call above silently ran the repo's current dev
# build instead — confirmed by a real run whose receipts carried
# policyVersion terraform-v0.2.1 (this repo's HEAD) instead of the actually
# published 0.5.0's terraform-v0.2.0. Running npx from a scratch directory
# with no ancestor package.json closes that: there is nothing local left to
# find, so --package really is what gets fetched and run.
NPX_CWD="$(mktemp -d)"
CLEANUP_PATHS+=("$NPX_CWD")

# Pinned release, resolved against the real registry. Matches
# evidence-manifest.json; bump both together or the evidence is ambiguous.
changesafe() {
  (cd "$NPX_CWD" && npx --yes --registry=https://registry.npmjs.org --package=changesafe@0.5.0 changesafe "$@")
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

state_sha256() {
  local tmp
  tmp="$(mktemp)"
  terraform -chdir="$INFRA" state pull > "$tmp"
  sha256 "$tmp"
  rm -f "$tmp"
}

require_tfvars() {
  if [ ! -f "$INFRA/terraform.tfvars" ]; then
    echo "Copy infra/terraform.tfvars.example to infra/terraform.tfvars and set name_suffix first." >&2
    exit 2
  fi
}

# === phase: baseline ===
# Creates the sandbox estate. This is operator setup, before any gating; the
# interactive confirmation is the operator's own approval of their own
# baseline, and no receipt is produced here.
phase_baseline() {
  require_tfvars
  mkdir -p "$EVIDENCE"
  terraform -chdir="$INFRA" init -input=false
  terraform -chdir="$INFRA" apply
  terraform -chdir="$INFRA" version -json > "$EVIDENCE/terraform-version.json"
  state_sha256 > "$EVIDENCE/baseline-state.sha256"
  echo "Baseline created. State sha256: $(cat "$EVIDENCE/baseline-state.sha256")"
}

# === phase: benign ===
# The benign proposal: update the demo SSM parameter in place. Plan, capture,
# gate, and only then apply the exact saved plan the gate read.
phase_benign() {
  require_tfvars
  mkdir -p "$EVIDENCE"

  terraform -chdir="$INFRA" plan -input=false \
    -var demo_value=tier2-updated \
    -out "$EVIDENCE/benign.tfplan"
  terraform -chdir="$INFRA" show -json "$EVIDENCE/benign.tfplan" \
    > "$EVIDENCE/benign.tfplan.json"
  sha256 "$EVIDENCE/benign.tfplan.json" > "$EVIDENCE/benign.tfplan.json.sha256"

  set +e
  changesafe gate \
    --domain terraform \
    --input "$EVIDENCE/benign.tfplan.json" \
    --receipt "$EVIDENCE/benign.receipt.json" \
    --format json > "$EVIDENCE/benign-gate.json"
  local gate_code=$?
  set -e
  echo "$gate_code" > "$EVIDENCE/benign-gate-exit-code.txt"

  if [ "$gate_code" -ne 0 ]; then
    echo "Gate exit code $gate_code — apply not reached. Inspect $EVIDENCE/benign-gate.json." >&2
    exit 1
  fi

  # Reached only when the deterministic gate exited 0. The receipt records
  # gate_only: what the policies found, not an approval and not an outcome.
  terraform -chdir="$INFRA" apply -input=false "$EVIDENCE/benign.tfplan" \
    2>&1 | tee "$EVIDENCE/benign-apply.log"

  state_sha256 > "$EVIDENCE/benign-post-apply-state.sha256"
  echo "Benign apply finished. Transcribe hashes into M1_TIER2_EVIDENCE.md."
}

# === phase: hostile ===
# The hostile proposal: bump the protected bucket's generation, forcing a
# delete-and-create of a resource tagged changesafe_protected, with a PR body
# that instructs tooling to approve anyway. The gate must exit 1; this phase
# then discards the plan artifact and proves the state never moved. There is
# deliberately no Terraform execution after the gate call in this function.
#
# demo_value is re-pinned here to the value the benign phase applied. Without
# it, Terraform falls back to the variable's declared default on every fresh
# plan, and the hostile plan would carry an unrelated pending change to the
# demo parameter — the proposal under test must be isolated to the one
# resource it deliberately targets.
phase_hostile() {
  require_tfvars
  mkdir -p "$EVIDENCE"

  # Informational only: a local-backend `plan` persists refreshed metadata to
  # the state file even when nothing is applied, so raw state hashes can
  # differ across two plans with zero actual infrastructure change. The
  # authoritative check below is the baseline `-detailed-exitcode` plan, not
  # this comparison.
  local pre_state_sha
  pre_state_sha="$(state_sha256)"
  echo "$pre_state_sha" > "$EVIDENCE/hostile-pre-state.sha256"

  terraform -chdir="$INFRA" plan -input=false \
    -var demo_value=tier2-updated \
    -var protected_bucket_generation=2 \
    -out "$EVIDENCE/hostile.tfplan"
  terraform -chdir="$INFRA" show -json "$EVIDENCE/hostile.tfplan" \
    > "$EVIDENCE/hostile.tfplan.json"
  sha256 "$EVIDENCE/hostile.tfplan.json" > "$EVIDENCE/hostile.tfplan.json.sha256"

  local key_dir
  key_dir="$(mktemp -d)"
  # Registered on the shared CLEANUP_PATHS array, not a fresh `trap ... EXIT`
  # here: bash EXIT traps don't stack, and the top-level trap already owns
  # cleaning up NPX_CWD. A second `trap` call in this function would replace
  # that one outright, leaking NPX_CWD on the ordinary success path.
  CLEANUP_PATHS+=("$key_dir")

  changesafe keygen \
    --out "$key_dir/hostile-signing-key" \
    --format json > "$EVIDENCE/hostile-keygen.json"

  set +e
  changesafe gate \
    --domain terraform \
    --input "$EVIDENCE/hostile.tfplan.json" \
    --context "$HERE/fixtures/hostile-pr-body.txt" \
    --receipt "$EVIDENCE/hostile.receipt.json" \
    --sign-key "$key_dir/hostile-signing-key.pem" \
    --format json > "$EVIDENCE/hostile-gate.json"
  local gate_code=$?
  set -e
  echo "$gate_code" > "$EVIDENCE/hostile-gate-exit-code.txt"

  if [ "$gate_code" -ne 1 ]; then
    echo "Expected the gate to BLOCK (exit 1) but got $gate_code. Stop and investigate." >&2
    exit 1
  fi

  # The blocked plan artifact is destroyed so nothing later can pick it up.
  rm -f "$EVIDENCE/hostile.tfplan"

  local post_state_sha
  post_state_sha="$(state_sha256)"
  echo "$post_state_sha" > "$EVIDENCE/hostile-post-state.sha256"

  # The proof that the hostile change never took effect: replanning against
  # the untouched baseline (protected_bucket_generation left at its default,
  # 1) with -refresh=false must show zero pending changes. -detailed-exitcode
  # returns 0 for "no changes", 2 for "changes present", 1 for an error.
  set +e
  terraform -chdir="$INFRA" plan -input=false -refresh=false -detailed-exitcode \
    -var demo_value=tier2-updated \
    > "$EVIDENCE/hostile-post-plan.log" 2>&1
  local post_plan_code=$?
  set -e
  echo "$post_plan_code" > "$EVIDENCE/hostile-post-plan-exit-code.txt"

  if [ "$post_plan_code" -ne 0 ]; then
    echo "A plan against the untouched baseline still shows pending changes (exit $post_plan_code) after the BLOCK. Stop and investigate." >&2
    exit 1
  fi

  cp "$key_dir/hostile-signing-key.pub.pem" "$EVIDENCE/hostile-signing-key.pub.pem"
  changesafe verify "$EVIDENCE/hostile.receipt.json" \
    --public-key "$EVIDENCE/hostile-signing-key.pub.pem" \
    --format json > "$EVIDENCE/hostile-verify.json"

  echo "Hostile path blocked; plan discarded; a baseline plan afterward shows zero pending changes."
}

# === phase: teardown ===
# Removes the sandbox estate when the exercise is over.
phase_teardown() {
  require_tfvars
  terraform -chdir="$INFRA" destroy
}

# === phase: hash ===
# Writes a checksum list over everything currently in evidence/ so the
# transcription into M1_TIER2_EVIDENCE.md has one anchor.
phase_hash() {
  mkdir -p "$EVIDENCE"
  (
    cd "$EVIDENCE"
    : > SHA256SUMS
    for file in *; do
      [ "$file" = "SHA256SUMS" ] && continue
      [ -f "$file" ] || continue
      echo "$(sha256 "$file")  $file" >> SHA256SUMS
    done
    cat SHA256SUMS
  )
}

case "${1:-}" in
  baseline) phase_baseline ;;
  benign)   phase_benign ;;
  hostile)  phase_hostile ;;
  teardown) phase_teardown ;;
  hash)     phase_hash ;;
  *)
    echo "Usage: $0 <baseline|benign|hostile|teardown|hash>" >&2
    exit 2
    ;;
esac
