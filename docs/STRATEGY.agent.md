# ChangeSafe — Agent Strategy Constraints

```yaml
doc_type: agent_constraints
version: 1
adopted: 2026-08-08
human_companion: docs/STRATEGY.md
authority: binding
precedence: >
  On conflict, docs/ARCHITECTURE.md design commitments win over this file.
  This file wins over docs/OSS_ROADMAP.md sequencing.
  This file does not override AGENTS.md or CLAUDE.md operational rules.
current_milestone: M4
implementation_track: M4_scoped_observation_not_implemented
method: research_loop            # adopted 2026-10-11, see §9
loop_ledger: docs/RESEARCH_LOOP.md
experiments: [docs/M4_EXPERIMENT_01.md, docs/M4_EXPERIMENT_02.md, docs/M4_EXPERIMENT_03.md, docs/M4_EXPERIMENT_04.md, docs/M4_EXPERIMENT_05.md, docs/M4_EXPERIMENT_06.md, docs/M4_EXPERIMENT_07.md, docs/M4_EXPERIMENT_08.md]
closed_milestones: [M2, M3]
closure_evidence: [docs/M2_CLOSEOUT.md, docs/M3_GUARANTEES.md]
inherited_question_review: docs/M0_RETROSPECTIVE_REVIEW.md
```

Read this before proposing, planning, or implementing any change in this
repository. It constrains *what work is allowed*, not how to write code.

---

## 1. Project identity

```yaml
kind: long_running_personal_systems_project
not: [startup, product, commercial_oss]
optimize_for: [technical_depth, architectural_coherence, claim_honesty, conceptual_progression]
do_not_optimize_for: [stars, adoption_count, customers, revenue, feature_count]
central_question: >
  How should an autonomous system be authorized to change consequential systems?
```

---

## 2. Hard rules

**MUST NOT:**

- R1. Create an issue, branch, milestone, or plan titled after a technology
  (e.g. "Add eBPF support", "Integrate OpenTelemetry"). Title with the question
  the work answers.
- R2. Implement anything from `backlog_frozen` (§6) without an explicit human
  decision recorded in `docs/STRATEGY.md`.
- R3. Implement `AuthorizationGrant`, actor delegation, or any authority
  semantics before milestone M2 is opened. If the need appears earlier, write a
  design memo and stop.
- R4. Add authority, permission, capability, or grant semantics to
  `ChangeReceipt`. `ChangeReceipt` is evidence of a decision. Its `decision`
  field includes `gate_only`, which is never an approval. Overloading this type
  is a correctness violation, not a style preference.
- R5. Write or imply a claim the system cannot prove. See §4 claim discipline.
- R6. Add a new infrastructure domain (a fourth `domain-*` package). Depth in
  existing domains only.
- R7. Import an external authorization ecosystem (JWT, Macaroons, SPIFFE, OAuth
  token exchange, Zanzibar-style models) as a starting design. Authority
  representation is counterexample-driven: start minimal, extend only when an
  experiment produces a failure the current shape cannot handle.
- R8. Close a milestone without its adversarial release gate exercised (§5).

**MUST:**

- R9. Evaluate any significant work against the four-question filter (§3) and
  record the result in the issue or plan.
- R10. Record findings, including negative results, per §5 formats.
- R11. Keep principles in exactly one location. Architectural principles live in
  `docs/ARCHITECTURE.md`; process principles live in `docs/STRATEGY.md`. Do not
  duplicate; link instead.

---

## 3. Decision filter

```yaml
filter:
  A: probes_central_thesis_more_deeply
  B: teaches_a_new_systems_concept
  C: yields_a_15min_defensible_engineering_story
  D: surfaces_a_problem_existing_abstractions_cannot_explain
threshold: 3_of_4_must_be_yes
on_fail: backlog_or_drop
note: >
  D distinguishes progression from accumulation. Work passing A-C but failing D
  is usually polish.
```

---

## 4. Claim discipline

### Effect stages — use this vocabulary exactly

```yaml
E0: authorized_proposal        # what ChangeSafe approved
E1: admitted_request           # object seen at the final validation boundary,
                               # after mutation and defaulting
E2: persisted_state            # what the API server actually stored
E3: realized_effect            # actual state after controllers reconcile

provable_today: [E0, E0_to_E1_binding_within_documented_scope]
provable_from_M2: [E0_to_E1_binding]
never_claim_without_new_work: [E2, E3]
```

`ALLOW` at an enforcement boundary is **not** a persistence attestation. A later
admission stage or the API server may still reject the request.

### Authority roles — separated in M2 source

```yaml
approver:         who decided the change was acceptable
authorized_actor: who may exercise that decision
executor:         who actually sent the request to the control plane
constraint: these three are not assumed equal from M2 onward
```

### Forbidden phrasings

Do not write, in code comments, docs, commit messages, or PR descriptions:

- "guarantees the actual effect"
- "proves the change was applied"
- "cryptographically guarantees the outcome"
- "ensures the cluster reached the desired state"
- any claim that a receipt or grant attests execution

Permitted analogues: "binds an authorization to the request presented at the
enforcement boundary", "attests what was decided", "proves integrity, not
authorship".

---

## 5. Milestone gates and record formats

### Adversarial release gate

No milestone closes until all are exercised and recorded:

```yaml
gate:
  - happy_path
  - malicious_path
  - malformed_input
  - receipt_or_grant_tampering
  - missing_artifact
  - component_failure
  - unexpected_upstream_output
  - review_of_open_M0_hypotheses
```

### `docs/ADVERSARIAL_FINDINGS.md` entry format

One entry per finding, id `CS-ADV-NNN`:

```
Finding CS-ADV-NNN
Hypothesis
Attack surface
Method
Minimal reproducer
Expected invariant
Observed behavior
Severity
Root cause
Fix
Regression test
What this changed in the architecture
Remaining uncertainty
```

The last two fields are mandatory and carry most of the value.

### Negative results are results

```yaml
rule: absence_of_finding_is_recordable
required_phrasing: "No counterexample found under attack model <X>."
forbidden_phrasing: "proven safe" | "no vulnerabilities" | "verified secure"
also_record: why the original hypothesis was not supported
```

### Review feedback is not a finding

```yaml
promotion_rule: >
  External review feedback enters an internal intake table only. It is promoted
  to ADVERSARIAL_FINDINGS.md only after being reproduced or technically verified.
```

---

## 6. Frozen backlog

```yaml
backlog_frozen:
  - ebpf
  - chaos_engineering
  - distributed_ledger
  - wasm_policy_sandbox
  - rego_integration
  - opentelemetry
  - reproducible_builds
  - slsa_levels
  - new_infrastructure_domains
  - jwt_macaroons_spiffe_oauth_zanzibar
unfreeze_condition: >
  A milestone result creates the need. Interest in the technology is not a
  reason.
```

---

## 7. Milestones

```yaml
M0:
  name: Expose assumptions
  target: 2026-08-15
  question: What are we not seeing?
  work:
    - pin baseline commit SHA; do not change during the review round
    - track_A: 4-5 perception reviewers, README + live demo only, Q1-Q2
    - track_B: >=1 (ideally 2) code-level reviewers, >=1 infra practitioner,
      Q3-Q5
    - collect all feedback before fixing anything
      (exception: publicly exploitable security issue)
    - add npm publish provenance
  output: internal intake table + M1 attack hypothesis backlog
  done_when: >
    >=3 independent reviews including >=1 infrastructure practitioner, and the
    M1 attack backlog is written
  forbidden: new feature development

M1:
  name: Make it real
  target: 2026-08-31
  question: Does the claimed story hold in a real control flow?
  paths:
    PR_A_benign: AI proposes small change -> PASS -> terraform apply
    PR_B_hostile: >
      AI proposes destructive change to protected stateful resource, PR body
      contains an instruction to approve anyway -> BLOCK -> apply never occurs
      -> signed receipt
  tier_1_required: >
    keyless independent reproduction from a captured terraform show -json
    fixture; npx changesafe + template repo. External reproduction condition
    applies ONLY here.
  tier_2_required: >
    real AWS sandbox execution by the author, evidence captured. Not an
    external reproduction condition.
  also_due:
    - first ADVERSARIAL_FINDINGS entries
    - LESSONS_LEARNED entry
    - one short public engineering note (must not extend the milestone)
  forbidden: AuthorizationGrant implementation (see R3)

M2:
  name: Bind authorization to enforcement
  target: 2026-09
  question: >
    Can a ChangeSafe authorization be exercised only by the authorized actor,
    for the exact operation, resource, and canonical object it was issued for?
  introduces:
    - AuthorizationGrant, separate from ChangeReceipt
    - approver / authorized_actor / executor separation
  minimal_grant_shape:
    [grant_id, receipt_id, authorized_actor, operation, resource,
     object_sha256, policy_version, issued_at, expires_at, signature]
  extend_only_on_counterexample: [nonce, use_state, revocation, anything_else]
  attack_cases:
    [object_substitution, resource_substitution, operation_substitution,
     identity_substitution, replay, stale_or_expired_grant,
     policy_version_drift, request_mutated_after_authorization]
  also_in_scope: risk_sensitive_failure_semantics (failurePolicy experiment)
  environment: kubernetes is the test environment, not the subject
  explicit_non_claims: ALLOW != persisted != reconciled != realized_effect
  output:
    [kind_cluster_reproduction, failure_mode_document,
     E1_E2_E3_gap_written_as_open_question, adversarial_gate, 90s_demo]

M3:
  name: State the guarantees
  cap: 1_week_hard
  scope: >
    TLA+ model of authorization protocol invariants that actually mattered in
    M2. Not a transcription of the existing state machine. Include a
    deliberately broken transition so the checker produces a counterexample.

M4:
  status: in_progress
  question: What evidence can connect an admitted request to stored state?
  selected_by: docs/M4_DECISION.md (from M2 and M3 results)
  deferred_candidates: [generalization_beyond_infrastructure,
                        deeper_kubernetes_authorization_semantics]
  experiments:
    - id: 01
      note: docs/M4_EXPERIMENT_01.md
      result: H1 hash-only correlation refuted offline
    - id: 02
      note: docs/M4_EXPERIMENT_02.md
      result: H2 executor-asserted version refuted; server-side audit binding proposed, unverified
    - id: 03
      note: docs/M4_EXPERIMENT_03.md
      result: H3a-H3e not refuted on one live kind run; refutes 02's first-event audit rule
    - id: 04
      note: docs/M4_EXPERIMENT_04.md
      result: audit-pipeline adversary can flip, fabricate and hide; a version-based read contradicts a false "stored" in two cases (nothing stored since the admission, which needs the recorded prior version P3; or the claimed version is newer than the read, which needs neither) and does not contradict a hidden write; P3, P4 proposed
    - id: 05
      note: docs/M4_EXPERIMENT_05.md
      result: H5a-H5e not refuted on one live kind run (protected tier); an independent watch contradicts flipped, fabricated and hidden-write claims on the recorded evidence; the read before a write is not the admission's prior version
    - id: 06
      note: docs/M4_EXPERIMENT_06.md
      result: a replay from the dry-run's response version (a stand-in for the admission's recorded oldObject version, which was not recorded) reproduces the live watch exactly; version 1 returned the whole retained history, not an error (H6b refuted); retention horizon unreached
    - id: 07
      note: docs/M4_EXPERIMENT_07.md
      result: bounded exhaustive check; experiment 05's pre-correction rule is unsound in 96 of 1728 protected-tier evaluations, and the corrected composition (v1c) is sound there and unsound only where the audit event decides; a carrier-keyed contract (post hoc) and the registered repair are both sound over the protected grid; assuming the carrier unforgeable in the default tier is unsound (192 for the carrier-keyed contract, 96 for the registered repair)
    - id: 08
      note: docs/M4_EXPERIMENT_08.md
      result: under an interpreted mapping, the contract's structure (incarnation, version, boundary-set carrier) is not in the Terraform artifact and no stored verdict follows without a carrier; grants are issuable for one of three domains; not a refutation of the Physical OS hypothesis
  adopted_into_core: none
  adopted_elsewhere: [P1 enforcer audit annotations, P2 consumer admission uid]   # 2026-10-11, PR #79
```

---

## 9. Research loop

```yaml
status: adopted_method            # owner decision 2026-10-11
human_companion: docs/STRATEGY.md#the-research-loop-method
ledger: docs/RESEARCH_LOOP.md     # append-only, one row per iteration
iteration:
  select:      from previous next_question or open milestone question; run §3 filter
  hypothesize: one falsifiable sentence, numbered H<n>
  experiment:  offline first; production functions under test; test-local contract
  record:      docs/M<k>_EXPERIMENT_<nn>.md with result in {refuted, not_refuted_under:<model>, unknown}
  gate:        owner decides adoption
```

**MUST NOT:**

- R12. Adopt a contract, schema, policy, or version bump discovered by an
  experiment in the same change that records the experiment. Propose in the
  note; adoption is a separate, human-decided change.
- R13. Write "self-improving", "recursive self-improvement", "autonomous
  research", or equivalents as a property of this project. The ledger may
  show it; prose may not claim it.
- R14. Select a next question that names a technology, or run an iteration
  that cannot produce a counterexample or an `unknown`.
- R15. Let the loop touch execution, approval, merge, release, publish, or
  this file's §2–§7 rules. The loop proposes; the gate is unchanged.

**MUST:**

- R16. Append one ledger row per iteration before the iteration's branch is
  offered for merge, including overclaims the agent caught in its own draft.

---

## 8. Physical OS

```yaml
status: hypothesis
not: roadmap_item
hypothesis: >
  proposal -> authorization -> capability -> effect -> observation ->
  verification recurs across environments and may name a larger runtime
  abstraction.
promotion_condition: >
  the abstractions keep reappearing on their own while digging into ChangeSafe.
  Approver != Authorized actor != Executor arrived this way at M2. Importing
  the vision to justify work is the failure mode.
forbidden_now: any code, package, or repo named for it
```
