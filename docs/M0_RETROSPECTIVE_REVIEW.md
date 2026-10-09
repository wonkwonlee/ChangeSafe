# Which inherited hypotheses remain open after M2 and M3?

**Record date:** 2026-10-08 (America/New_York).
**Authority:** Raymond explicitly delegated M2 official close-out and M3
formal verification completion to the implementing agent. This is a delegated
retrospective review, not a claim that Raymond personally reviewed each row.
**Disposition:** the inherited-question review is complete for the documented
evidence baseline; unresolved questions below remain open with scope and next
actions. No additional approval is requested by this record.

## Evidence baseline and provenance limitation

The original private M0 intake is not available. The public
[M1 lesson](LESSONS_LEARNED.md) records ten historical hypotheses but does not
publish their wording or IDs. Repository history has no tracked M0/hypothesis
table. The prior targeted file and conversation lookup did not recover it.
Consequently this review **does not reconstruct the original ten rows**, certify
all original reviewer feedback was addressed, or invent reviewer attribution.

The review inventory below is reconstructed from the published M1 dispositions,
[verified findings](ADVERSARIAL_FINDINGS.md), current implementation and
[M2 boundary completion](M2_BOUNDARY_COMPLETION.md). Its R-prefixed IDs are new
review IDs, not original M0 IDs. The inventory is organized by question rather
than made to match the historical count. M0 provenance uncertainty is itself
retained as R-11.

The binding [adversarial gate](STRATEGY.agent.md#5-milestone-gates-and-record-formats)
requires review and recording of open hypotheses; unresolved questions may be
explicitly deferred, as demonstrated by the M1 close-out lesson. It does not
require every hypothesis to be fixed. The owner-delegated closure uses this
retrospective record as the review baseline. It does not retroactively change
M0's independent-review completion criteria or certify that round anew.

Implementation baseline: PR #77 commit
`4a84799161a32938d15e06fb24f08c3c431e41db`, tree
`32473c7af757c40fcd1c87df916b464beb304663`. Its
[CI run](https://github.com/wonkwonlee/ChangeSafe/actions/runs/37878264318)
passed all seven jobs, including 1,353 unit/integration tests, 42 browser tests,
and live Kubernetes admission reproduction. Closure edits change documentation
only. Local targeted checks and model replay are recorded in the PR validation.

## Review inventory and dispositions

| ID | Hypothesis / inherited question | Evidence examined | Disposition and next action |
| --- | --- | --- | --- |
| R-01 | Hostile text or a blocked proposal can become approval or infrastructure execution | CS-ADV-001; [state-machine tests](../tests/unit/state-machine.test.ts); [M1 captured-plan tests](../tests/integration/m1-tier1-terraform-template.test.ts); [server review tests](../packages/server/tests/reviews.test.ts) | No counterexample found under attack model captured Terraform artifacts and authenticated supported review decisions. Keep BLOCK unapprovable. No execution path added. This does not cover arbitrary agent executors. |
| R-02 | A receipt proves all policy inputs, authorship, authorization, or an actual effect | CS-ADV-002; [signature tests](../packages/core/tests/signature.test.ts); [receipt tests](../tests/unit/receipt.test.ts); [architecture](ARCHITECTURE.md) | Policy-pack identity remains OPEN in Terraform evidence. Retain a future receipt-provenance design task. Signature requires out-of-band trust; gate_only is evidence, never authority. E2/E3 remain unclaimed. |
| R-03 | Public replay, client verdicts, or another user's review can issue real authority | CS-ADV-004/013; [public transport boundary](../tests/unit/public-replay-transport-boundary.test.ts); [owner-scoped reviews](../packages/server/tests/reviews.test.ts); [OIDC tests](../packages/server/tests/oidc.test.ts) | Addressed for authenticated immutable HTTP intake and server-derived issuance. No client grant template or verdict is trusted. Operator HTTPS gateway/BFF integration remains OPEN outside M2's server protocol; validate it before a browser deployment claims turnkey self-hosting. |
| R-04 | Object, metadata, operation, or resource substitution escapes reviewed-object binding | CS-ADV-003/005/011/013; [verifier tests](../packages/kubernetes-enforcer/tests/verify.test.ts); [issuance-to-enforcement tests](../tests/integration/m2-grant-issuance-to-enforcement.test.ts) | Addressed for the supported CREATE/UPDATE contract and full canonical object excluding the grant annotation. Mutated/defaulted objects require exact reviewed form. Unsupported kinds/operations are denied, not generalized by closure. |
| R-05 | Actor name or resource name equality hides a different incarnation | CS-ADV-008/014/016; [verifier tests](../packages/kubernetes-enforcer/tests/verify.test.ts); [issuance tests](../packages/server/tests/issue-grant.test.ts) | Actor UID enforced when configured; resource UID/prior-state UPDATE bindings checked. Username-only actor binding remains a weaker OPEN deployment choice. Use UID-bound actors where lifetime identity matters; no stronger identity claim follows from closure. |
| R-06 | Namespace routing changes, Scale/HPA, or CREATE bootstrap bypass protection | CS-ADV-006/009/012; [native guards](../examples/m2-kubernetes-enforcer/routing-guards.yaml); [kind reproduction](../examples/m2-kubernetes-enforcer/kind-repro.sh) | Protected namespace downgrade/deletion and protected Scale are denied by native guards; CREATE registration/bootstrap tested. Trusted cluster admins and removal of guards remain outside the attack model. Supporting DELETE or HPA grants requires a separate design. |
| R-07 | Concurrent approval, response loss or recovery creates new authority | CS-ADV-007; [journal tests](../packages/server/tests/grant-journal.test.ts); [review recovery tests](../packages/server/tests/reviews.test.ts); M3 OneIdentityPerReview | Addressed by frozen intent, durable issued grant and receipt-derived identity. Changed-intent retries denied; identical recovery returns the stored grant. Availability or eventual delivery is not proved. |
| R-08 | Replay, restart or storage outage allows a second actual use | CS-ADV-018; [SQLite use-state tests](../packages/kubernetes-enforcer/tests/sqlite-use-state.test.ts); [server tests](../packages/kubernetes-enforcer/tests/server.test.ts); M3 AtMostOnce/ConsumptionBeforeAllow | Addressed with one reliable shared local SQLite file and atomic consumption before ALLOW. Cross-node HA, separate files, backup rollback/restore and compromised storage remain OPEN and unsupported. Do not deploy independent use-state replicas as equivalent. |
| R-09 | Stale/expired authority, policy drift or dry-run has unsafe semantics | CS-ADV-010/017; [verifier tests](../packages/kubernetes-enforcer/tests/verify.test.ts); [issuance tests](../packages/server/tests/issue-grant.test.ts); M3 time/policy/dry-run checks | Expiry and configured policy mismatch deny; issuance lifetime checked; dry-run does not consume. Delivery deadline and clock synchronization remain OPEN assumptions. Dry-run reserves nothing; actual admission rechecks. |
| R-10 | Component outage or ALLOW can be read as universal authorization or successful persistence | [kind reproduction](../examples/m2-kubernetes-enforcer/kind-repro.sh); M3 default-overclaim trace; [M3 limits](M3_GUARANTEES.md) | Default Ignore outage bypass is an accepted documented availability boundary; protected Fail behavior reproduced. E1→E2 uncertainty remains OPEN and selects [M4](M4_DECISION.md). Single-use consumption can occur even when later persistence fails. |
| R-11 | Published dispositions may omit an original private M0 concern | [M1 lesson](LESSONS_LEARNED.md); missing original intake/history | OPEN historical completeness uncertainty, retained independently of runtime claims. Recover the private record when available, compare every original row to R-01–R-10, and reopen the affected milestone if an omitted in-scope safety counterexample appears. No claim that the original ten were recovered. |

## Completion judgment

No counterexample found under attack model authenticated immutable supported
Kubernetes review intake, exact CREATE/UPDATE grant binding, installed native
routing guards, trusted signing/policy configuration and reliable shared local
SQLite consumption, beyond the explicitly retained boundaries above. The
concrete code tests and live cluster evidence support that scoped judgment;
the bounded model checks support protocol invariants under their own assumptions.
Neither is a full-system proof or evidence of E2/E3.

The required inherited-question review is exercised and recorded. All identified
in-scope reproduced defects have dispositions; remaining uncertainties have
explicit next actions. The implementing agent's closure judgment under that delegation treats R-11
as nonblocking provenance debt, not fabricated evidence; it does not attribute
a per-row acceptance or a risk-waiver statement to the owner. M2 and M3 can close for
their documented scopes. Any later contradictory evidence must amend this
record and reopen the relevant claim; the historical record is never overwritten.
