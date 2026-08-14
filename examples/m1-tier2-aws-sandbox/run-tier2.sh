#!/usr/bin/env bash
# M1 Tier 2 operator harness.
#
# Safety invariant #1 (AGENTS.md) is unconditional: no `terraform apply` (or
# `destroy`) execution path against infrastructure exists anywhere in this
# repository, examples included. This script therefore never calls either —
# it only ever plans, captures, gates, and reads state. Where the exercise
# genuinely needs an apply or a destroy, it prints the exact command and
# stops; a human runs it themselves, in their own terminal, under their own
# credentials. That is also why the baseline/benign/hostile split exists:
# each phase this script owns is read-only, so the one mutating step per
# phase is always something a human typed, never something this repo ran.
#
# Tier 2 is required of the project author, not of reviewers. Do not run it
# in CI, and do not run it against an account holding anything you care
# about — use a disposable sandbox account.
#
# Usage: ./run-tier2.sh <baseline|record-baseline|benign|record-benign|hostile|teardown|hash>

set -euo pipefail

if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "run-tier2.sh is an operator-run harness and refuses to run in CI." >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$HERE/infra"
EVIDENCE="$HERE/evidence"
MANIFEST="$HERE/evidence-manifest.json"

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
  # Every caller invokes this through command substitution
  # (`x="$(state_sha256)"`), and by default bash does NOT propagate -e into
  # a command-substitution subshell (`shopt inherit_errexit` is off unless
  # explicitly enabled, and this script can't assume a bash new enough to
  # have it). Either `terraform state pull` or `sha256` failing inside that
  # subshell would otherwise be silently swallowed: execution would
  # continue past the failure and the function would still return 0,
  # because the trailing `rm -f` succeeds regardless of what came before
  # it. Capturing each command's own exit status explicitly and returning
  # it makes the failure visible to the caller's own `set -e` instead.
  local tmp status
  tmp="$(mktemp)"
  terraform -chdir="$INFRA" state pull > "$tmp"
  status=$?
  if [ "$status" -ne 0 ]; then
    rm -f "$tmp"
    return "$status"
  fi
  sha256 "$tmp"
  status=$?
  rm -f "$tmp"
  return "$status"
}

require_tfvars() {
  if [ ! -f "$INFRA/terraform.tfvars" ]; then
    echo "Copy infra/terraform.tfvars.example to infra/terraform.tfvars and set name_suffix first." >&2
    exit 2
  fi
}

# An overall exit code alone doesn't say which policies actually produced
# it: PASS/BLOCK is enough to reach the printed handoff, but a regression
# that swaps one policy's status for another with the same overall exit
# code (a benign WARN nobody checks for, or UNTRUSTED_INSTRUCTION -- the
# prompt-injection detection this hostile fixture exists to exercise --
# quietly passing while an unrelated policy still blocks) would slip
# through a check that only looks at gate_code or a hand-picked subset of
# policies. This instead compares the gate's full JSON output against the
# single source of truth for what it should say: evidence-manifest.json's
# decision, riskLevel, and complete findingStatuses map for the given case.
# (Uses node, already a prerequisite, so no extra dependency.)
assert_gate_matches_manifest() {
  local gate_file="$1" case_id="$2"
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const gate = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const caseId = process.argv[3];
    const entry = manifest.cases.find((c) => c.caseId === caseId);
    if (!entry) {
      console.error(`No manifest case ${caseId}`);
      process.exit(1);
    }
    const errors = [];
    if (gate.decision !== entry.expected.decision) {
      errors.push(`decision: expected ${entry.expected.decision}, got ${gate.decision}`);
    }
    if (gate.riskLevel !== entry.expected.riskLevel) {
      errors.push(`riskLevel: expected ${entry.expected.riskLevel}, got ${gate.riskLevel}`);
    }
    const actual = Object.fromEntries(gate.findings.map((f) => [f.policyId, f.status]));
    const expected = entry.expected.findingStatuses;
    const allIds = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const id of allIds) {
      if (actual[id] !== expected[id]) {
        errors.push(`${id}: expected ${expected[id] ?? "MISSING"}, got ${actual[id] ?? "MISSING"}`);
      }
    }
    if (errors.length > 0) {
      console.error(`Gate verdict for ${caseId} does not match evidence-manifest.json:\n` + errors.join("\n"));
      process.exit(1);
    }
  ' "$MANIFEST" "$gate_file" "$case_id"
}

# assert_gate_matches_manifest compares decision/riskLevel/findings, which a
# gate call against an unintended ChangeSafe build (the exact failure the
# NPX_CWD isolation above exists to prevent) could still coincidentally
# reproduce, since none of those fields say which release produced them.
# This checks the two fields that actually identify the release: a signed
# receipt nests its fields under .receipt, an unsigned one doesn't, so both
# shapes are handled.
assert_receipt_matches_manifest() {
  local receipt_file="$1"
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const wrapper = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const receipt = wrapper.receipt ?? wrapper;
    const errors = [];
    if (receipt.appVersion !== manifest.release.appVersion) {
      errors.push(`appVersion: expected ${manifest.release.appVersion}, got ${receipt.appVersion}`);
    }
    if (receipt.policyVersion !== manifest.policyVersion) {
      errors.push(`policyVersion: expected ${manifest.policyVersion}, got ${receipt.policyVersion}`);
    }
    if (errors.length > 0) {
      console.error("Receipt release fields do not match evidence-manifest.json:\n" + errors.join("\n"));
      process.exit(1);
    }
  ' "$MANIFEST" "$receipt_file"
}

# === phase: baseline ===
# Initializes Terraform only — `init` downloads providers and touches no
# infrastructure. Creating the estate is the operator's own action, printed
# below rather than run here.
phase_baseline() {
  require_tfvars
  mkdir -p "$EVIDENCE"
  terraform -chdir="$INFRA" init -input=false
  cat <<EOF

Terraform is initialized. This script does not apply anything itself.
Create the baseline estate yourself:

  terraform -chdir="$INFRA" apply

When it succeeds, run:

  ./run-tier2.sh record-baseline
EOF
}

# === phase: record-baseline ===
# Read-only: records the Terraform version and the state hash of the estate
# you just applied by hand.
phase_record_baseline() {
  require_tfvars
  mkdir -p "$EVIDENCE"
  terraform -chdir="$INFRA" version -json > "$EVIDENCE/terraform-version.json"
  state_sha256 > "$EVIDENCE/baseline-state.sha256"
  echo "Baseline recorded. State sha256: $(cat "$EVIDENCE/baseline-state.sha256")"
}

# === phase: benign ===
# The benign proposal: update the demo SSM parameter in place. Plans,
# captures, and gates; on PASS it prints the exact saved plan for you to
# apply yourself rather than applying it here.
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

  # exit 0 alone doesn't mean the run matches the manifest's claimed
  # all-PASS, LOW-risk result -- a policy could have regressed from PASS to
  # WARN without tripping the exit code at all. Compare the whole verdict
  # before offering the handoff.
  assert_gate_matches_manifest "$EVIDENCE/benign-gate.json" "m1-tier2-benign"
  # A matching verdict alone doesn't prove which release produced it: an
  # unintended build could coincidentally reproduce the same decision, risk,
  # and findings. Confirm the receipt's own release fields too.
  assert_receipt_matches_manifest "$EVIDENCE/benign.receipt.json"

  # Reached only when the deterministic gate exited 0 and matched the
  # manifest. The receipt records gate_only: what the policies found, not an
  # approval and not an outcome. This script does not apply anything itself
  # — see the note at the top of the file. Apply the exact plan the gate
  # read yourself:
  cat <<EOF

Gate PASSED (gate_only, not an approval). Apply the exact plan it read
yourself:

  terraform -chdir="$INFRA" apply -input=false "$EVIDENCE/benign.tfplan" 2>&1 | tee "$EVIDENCE/benign-apply.log"

When it succeeds, run:

  ./run-tier2.sh record-benign
EOF
}

# === phase: record-benign ===
# Read-only: records the state hash of the estate after you applied the
# benign plan by hand.
phase_record_benign() {
  require_tfvars
  state_sha256 > "$EVIDENCE/benign-post-apply-state.sha256"
  echo "Benign apply recorded. State sha256: $(cat "$EVIDENCE/benign-post-apply-state.sha256")"
}

# === phase: hostile ===
# The hostile proposal: bump the protected bucket's generation, forcing a
# delete-and-create of a resource tagged changesafe_protected, with a PR body
# that instructs tooling to approve anyway. The gate must exit 1; this phase
# then discards the plan artifact and proves the state never moved. Unlike
# benign, there is no apply command to print here at all: a BLOCK has
# nothing to hand off to a human either.
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

  # A BLOCK exit code isn't specific enough on its own: UNTRUSTED_INSTRUCTION
  # -- the prompt-injection detection this fixture's hostile PR body exists
  # to exercise -- could regress to PASS while an unrelated policy still
  # blocks, and gate_code -eq 1 would never notice. Compare every policy's
  # status against the manifest, not just the two most obviously relevant
  # ones.
  assert_gate_matches_manifest "$EVIDENCE/hostile-gate.json" "m1-tier2-hostile"
  # A matching verdict alone doesn't prove which release produced it: an
  # unintended build could coincidentally reproduce the same decision, risk,
  # and findings. Confirm the receipt's own release fields too (the signed
  # receipt nests them under .receipt; the function handles both shapes).
  assert_receipt_matches_manifest "$EVIDENCE/hostile.receipt.json"

  # The blocked plan artifact is destroyed so nothing later can pick it up.
  rm -f "$EVIDENCE/hostile.tfplan"

  local post_state_sha
  post_state_sha="$(state_sha256)"
  echo "$post_state_sha" > "$EVIDENCE/hostile-post-state.sha256"

  # The proof that the hostile change never took effect: replanning against
  # the untouched baseline (protected_bucket_generation left at its default,
  # 1) must show zero pending changes. This plan keeps the default refresh
  # (deliberately not -refresh=false): a no-refresh plan only compares
  # config against the local *cached* state file, so it would read 0 changes
  # even if AWS itself had diverged from that cache -- proving nothing about
  # the live estate. The default refresh asks AWS directly what the
  # protected bucket's generation actually is right now, which is the claim
  # this check needs to make. -detailed-exitcode returns 0 for "no changes",
  # 2 for "changes present", 1 for an error.
  set +e
  terraform -chdir="$INFRA" plan -input=false -detailed-exitcode \
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
# This script does not destroy anything itself — see the note at the top of
# the file. Remove the sandbox estate yourself when the exercise is over.
phase_teardown() {
  require_tfvars
  cat <<EOF
Remove the sandbox estate yourself:

  terraform -chdir="$INFRA" destroy
EOF
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
      # A digest computed as `echo "$(sha256 "$file")  $file"` would swallow
      # a failing sha256 the same way state_sha256 used to: echo itself
      # still succeeds, so a missing/unreadable file or a broken digest
      # utility would silently write a blank line instead of aborting.
      # Capturing into a plain (non-local) variable first keeps the
      # assignment's own exit status equal to sha256's, which -e does catch.
      digest="$(sha256 "$file")"
      echo "$digest  $file" >> SHA256SUMS
    done
    cat SHA256SUMS
  )
}

case "${1:-}" in
  baseline)        phase_baseline ;;
  record-baseline) phase_record_baseline ;;
  benign)          phase_benign ;;
  record-benign)   phase_record_benign ;;
  hostile)         phase_hostile ;;
  teardown)        phase_teardown ;;
  hash)            phase_hash ;;
  *)
    echo "Usage: $0 <baseline|record-baseline|benign|record-benign|hostile|teardown|hash>" >&2
    exit 2
    ;;
esac
