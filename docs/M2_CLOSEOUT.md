# Can M2's claims be closed from reproducible evidence?

Baseline: `f17b5807b26ca93669aac60308288347f0b39bf6` (PR #76 merged).
Owner authorization: 2026-10-08, close-out, modeling and release preparation.
Decision filter: A yes (verify the claimed boundary); B yes (distinguish
admission, storage and observed effect); C yes (reproducible failure story);
D yes (the E1/E2 gap survives correct single-use authority).

**Official close-out: complete for the documented M2 scope**, under the
owner's 2026-10-08 explicit delegation of closure and verification. The
[retrospective inherited-question review](M0_RETROSPECTIVE_REVIEW.md) exercises
the final process gate and retains all known unresolved questions. Its new
review IDs are not the original private M0 IDs; historical completeness remains
an explicit nonblocking provenance uncertainty. This closure does not certify
that the unavailable original ten-row intake was recovered.

## Adversarial exit matrix

| Required gate | Evidence | Result / scope |
| --- | --- | --- |
| Happy path | `packages/server/tests/reviews.test.ts`, `tests/integration/m2-kind-authorize.test.ts`, retained CI transcript | HTTP intake → server-derived grant → live server dry-run → actual ALLOW |
| Malicious path | verifier/HTTP suites and kind routing attempts | object/actor/operation/resource substitution denied; namespace downgrade and protected Scale denied |
| Malformed input | `packages/kubernetes-enforcer/tests/admission-review.test.ts`, `server.test.ts`, HTTP intake tests | bounded parsing, invalid grant/artifact, missing UID and unsupported contract refused |
| Receipt/grant tampering | core signature tests, `m2-grant-issuance-to-enforcement.test.ts`, grant-journal tests | untrusted signer, modified full object, corrupt journal and post-approval drift refused |
| Missing artifact | enforcer missing-grant case, HTTP raw-bundle and missing snapshot UID checks | no authority inferred from an absent grant or unsupported review bundle |
| Component failure | review recovery/storage injection, SQLite multi-process/restart, live verifier outage | same-intent recovery; consumption errors explicit DENY; protected Fail / default Ignore demonstrated |
| Unexpected upstream output | raw unsupported objects, OIDC malformed/JWKS tests, collector normalization suites | unexpected external schemas fail validation; no model or client verdict becomes authority |
| Open M0 hypotheses | [delegated retrospective review](M0_RETROSPECTIVE_REVIEW.md), R-01–R-11 | Reviewed and recorded; scope limits and original-intake uncertainty explicitly carried forward |

No counterexample found under attack model authenticated immutable review
intake, supported CREATE/UPDATE bindings, shared local SQLite consumption,
and installed native routing guards, beyond the explicitly retained limits
in [boundary completion](M2_BOUNDARY_COMPLETION.md).

## Public findings disposition

Entries in `ADVERSARIAL_FINDINGS.md` preserve historical observations; its
boundary-completion amendment supersedes the original gaps.

| Finding | Current disposition |
| --- | --- |
| CS-ADV-001 | Terraform captured-plan gate held; outside Kubernetes issuance |
| CS-ADV-002 | Policy-pack provenance remains open in Terraform receipts; not silently covered by policy version |
| CS-ADV-003 / 005 | Grant annotation excluded only as required; full spec/metadata binding has regression coverage |
| CS-ADV-004 / 013 | Raw HTTP review artifacts and server-derived issuance implemented |
| CS-ADV-006 | Protected Scale/HPA explicitly denied; parent UPDATE remains supported |
| CS-ADV-007 | Immutable intent, persisted grant and identical retry recovery implemented |
| CS-ADV-008 | UID binding enforced when requested; username-only grants remain a documented weaker option |
| CS-ADV-009 | Native namespace protection independent of webhook selector implemented |
| CS-ADV-010 | Minimum issuance lifetime checked; no guaranteed delivery-latency bound |
| CS-ADV-011 / 012 | Resource derived at admission; CREATE registration and bootstrap order exercised |
| CS-ADV-014 / 015 / 016 | UPDATE prior hash, deletion lifecycle and resource incarnation bound |
| CS-ADV-017 | Runnable enforcer always binds a configured/bundled policy version |
| CS-ADV-018 | Durable single-use across restart/processes sharing one reliable SQLite file; no cross-node HA/restore guarantee |

CS-ADV-015 is recorded in CS-ADV-014's amendments, not a separate heading.
DELETE, other workload kinds, revocation and actual effects remain outside
this scope. Unsupported operations are not claimed as protected.

## Live evidence provenance

The retained [CI transcript](../examples/m2-kubernetes-enforcer/evidence/2026-10-08-ci-transcript.txt)
is from [run 37728132291](https://github.com/wonkwonlee/ChangeSafe/actions/runs/37728132291),
head `bc15a3166d8bb2d79c21e7b9e9f6995595138a40`, artifact
`11528841178` (`admission-reproduction`). The downloaded ZIP SHA-256 matched
GitHub's artifact digest:
`c34f93be8ffbd144eada03bcf19dc57236e5d53e050fd05e52706ead8112c1f7`.
This is the PR #76 path, not the older checked-in original demo run.
Docker/kind are unavailable in the current local environment; no new local
cluster run is claimed. Subsequent CI runs upload their own transcript.

Baseline local verification on Node 22.23.3/npm 10.9.8: lint, typecheck,
CLI/package build, production build and 1,352 tests passed; four opt-in
tests skipped. The earlier PR's count includes a different build/opt-in
context. The separate CI live kind test is not counted as a local pass.

## Close-out decision and fresh verification

M2 is closed for authenticated immutable intake, supported CREATE/UPDATE
binding, installed routing guards and reliable shared local SQLite consumption.
The eight adversarial gates have been exercised and recorded; closing does not
resolve every deferred question or strengthen the stated attack model.
The final inherited-question review is [R-01–R-11](M0_RETROSPECTIVE_REVIEW.md).

[PR #77 CI run 37878264318](https://github.com/wonkwonlee/ChangeSafe/actions/runs/37878264318)
passed all seven jobs on commit `4a84799161a32938d15e06fb24f08c3c431e41db`:
1,353 tests passed (three opt-in skips), 42 Playwright tests passed, and fresh
live kind admission/outage reproduction succeeded. Fresh admission artifact:
`11593616040`; authorization-model artifact: `11592914416`. The retained older
transcript above remains historical and is not relabeled as this run.

The documentation-only close-out also reran 243 targeted tests across core,
server, enforcer, workflow/transport boundaries and M1/M2 integration paths,
and both normal plus all six negative TLC cases with exact snapshot comparison.
No runtime or model behavior changed. The repository-triggered code review on
`4a84799` completed with no reported findings; closure documentation is
implementing-agent reviewed and subject to the updated PR's automated review.

M3 closes with its own [scoped formal verification record](M3_GUARANTEES.md).
The current milestone advances to M4, whose [observation experiment](M4_DECISION.md)
remains designed but unimplemented. Release publication and PR merge are
separate actions and are not prerequisites for these engineering milestones.
