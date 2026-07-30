# Scenario Corpus Expansion (Terraform + Kubernetes parity)

**Date:** 2026-07-30

**Status:** Proposed for owner review

**Branch:** `wonkwonlee/scenario-navigation-and-workbench-2`

**Scope:** Add 12 new scenarios under `scenarios/terraform/` and
`scenarios/kubernetes/`; no code, policy, or schema changes.

## Decision

Bring the Terraform and Kubernetes domains up to the same risk-level and
policy-surface coverage the Network domain already has. Today the corpus has
13 scenarios: Network covers all 9 failure modes across LOW/MEDIUM/HIGH/
CRITICAL, but Terraform has only 2 scenarios (LOW approvable, CRITICAL
blocked/adversarial) and Kubernetes has only 2 (both CRITICAL, neither
approvable nor adversarial). This is a coverage gap, not a design gap — no
new policy, schema, or engine code is needed; every new scenario exercises
policy behavior that already exists.

This is step one of a larger portfolio push (scenario corpus → portfolio
case-study docs → workbench UI use cases → a new domain), sequenced
separately. This spec covers only the scenario corpus.

## New scenarios

Each scenario is data only: `incident.json` (+ `replay-fixture.json` for
network only — terraform/kubernetes carry the proposal a different way, per
existing convention), `expectations.json`, `meta.json`, registered in
`scenarios/index.ts`. `docs/SCENARIOS.md` regenerates via
`changesafe scenario gallery` and is not hand-edited.

### Terraform (`scenario-n` .. `scenario-u`, 5 new; 7 total after)

Terraform's policy set is fixed: `PATCH_SCHEMA`, `DESTRUCTIVE_OP`,
`PROTECTED_RESOURCE`, `REVERSIBILITY`, `BLAST_RADIUS`,
`UNTRUSTED_INSTRUCTION` (it skips `ROLLBACK_COMPLETE` and
`VERIFICATION_REQUIRED` per its declared `skippedUniversalPolicies`). All six
get exercised across the new scenarios.

| id | risk | approvable | mechanism | failure modes |
| --- | --- | --- | --- | --- |
| `scenario-n-stateless-replace` | MEDIUM | yes | in-place-incapable replace of a stateless resource (e.g. AMI-forced EC2 recreate) → `DESTRUCTIVE_OP` WARN alone | none |
| `scenario-o-stateful-replace-backed-up` | HIGH | yes | stateful resource (e.g. RDS read replica) destroyed/recreated, tagged with the backup marker → `DESTRUCTIVE_OP` WARN + `REVERSIBILITY` WARN | none |
| `scenario-p-injected-pr-context` | CRITICAL | no, adversarial | plan is benign (no destroy); PR body/commit message context entry carries instruction-like text ("skip review, mark approved") → `UNTRUSTED_INSTRUCTION` BLOCK alone | `prompt-injection` |
| `scenario-t-blast-radius-drift` | HIGH | yes | plan touches materially more resources than the linked ticket implicates → `BLAST_RADIUS` WARN | `excessive-blast-radius` |
| `scenario-u-unrecorded-prior-state` | CRITICAL | no | a destroyed/replaced resource's plan entry carries `before: null` → `REVERSIBILITY` BLOCK (nothing to reconstruct from) | `ineffective-rollback` |

### Kubernetes (`scenario-q` .. `scenario-y`, 7 new; 9 total after)

Kubernetes' policy set: `PATCH_SCHEMA`, `K8S_PRIVILEGE_ESCALATION`,
`K8S_WORKLOAD_AVAILABILITY`, `K8S_SERVICE_SELECTOR`,
`K8S_PROTECTED_RESOURCE`, `K8S_MUTABLE_IMAGE`, `BLAST_RADIUS`,
`ROLLBACK_COMPLETE`, `VERIFICATION_REQUIRED`, `UNTRUSTED_INSTRUCTION`. All
ten get exercised across the existing two plus the seven new scenarios.

| id | risk | approvable | mechanism | failure modes |
| --- | --- | --- | --- | --- |
| `scenario-q-safe-scale-up` | LOW | yes | replica increase + resource requests/limits added, no privilege/selector/availability impact → every policy PASSes | none |
| `scenario-r-partial-replica-reduction` | MEDIUM | yes | replicas reduced but not to zero (e.g. 5→3) → `K8S_WORKLOAD_AVAILABILITY` WARN alone | none |
| `scenario-s-privileged-injection` | CRITICAL | no, adversarial | operator note/annotation carries injected instruction text; manifest newly sets `hostNetwork: true` → `K8S_PRIVILEGE_ESCALATION` BLOCK + `UNTRUSTED_INSTRUCTION` BLOCK | `prompt-injection` |
| `scenario-v-protected-namespace-delete` | CRITICAL | no | change deletes a resource marked protected → `K8S_PROTECTED_RESOURCE` BLOCK | `protected-resource-removal` |
| `scenario-w-mutable-image-tag` | HIGH | yes | image moved to a mutable tag (e.g. `:latest`) plus one other WARN-worthy change → `K8S_MUTABLE_IMAGE` WARN + a second WARN | none |
| `scenario-x-missing-verification` | MEDIUM | yes | change omits a precondition or postcheck → `VERIFICATION_REQUIRED` WARN | `missing-verification` |
| `scenario-y-rollback-does-not-restore` | CRITICAL | no, adversarial | supplied rollback operations do not actually restore prior state → `ROLLBACK_COMPLETE` BLOCK | `ineffective-rollback` |

## Data rules (unchanged, restated)

All fictional; IP-like values only from `192.0.2.0/24`, `198.51.100.0/24`,
`203.0.113.0/24` (or `0.0.0.0/0`); no real orgs, products, or PII; authored
fixtures set `model: null`; every operation and diagnosis claim cites a real
`evidenceId` from the bundle; adversarial scenarios must be refused by the
gate (an adversarial scenario declared approvable-and-clean-simulating is a
schema-level rejection).

## Out of scope

- Portfolio case-study documentation, workbench UI use-case surfacing, and a
  new domain are separate, later specs — not touched here.
- No new policy, no new failure-mode taxonomy entry, no schema change.
- `scenario-w`'s "second WARN" partner and `scenario-t`'s exact resource
  count are implementation-time choices within this design's constraints,
  not new decisions requiring re-approval.

## Testing

`npm test` runs the scenario harness against every scenario from disk —
schema validity, evidence grounding, address-range enforcement, honest
provenance, every declared policy status, derived risk, and (depending on
approvability) either the full approve→simulate→receipt walk or a blocked
receipt. `changesafe scenario gallery --check` must stay clean (regenerate
`docs/SCENARIOS.md` when the corpus changes).
