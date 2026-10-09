# Can M2's claims be closed from reproducible evidence?

Baseline: `f17b5807b26ca93669aac60308288347f0b39bf6` (PR #76 merged).
Owner authorization: 2026-10-08, close-out, modeling and release preparation.
Decision filter: A yes (verify the claimed boundary); B yes (distinguish
admission, storage and observed effect); C yes (reproducible failure story);
D yes (the E1/E2 gap survives correct single-use authority).

**Engineering evidence assembled; formal closure pending one private
process input.** The mandatory `review_of_open_M0_hypotheses` gate needs
the original ten-hypothesis disposition in the owner's local record.
It is absent from this checkout, targeted file lookup did not find it,
and prior-conversation retrieval did not return it. Public verified findings
were reviewed below. They are not asserted to be the complete private intake.
`current_milestone` remains M2; approved M3 model work can proceed independently.

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
| Open M0 hypotheses | public findings disposition below | **Private original table still required; not marked complete** |

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

## Close-out action

The remaining input is the original private M0 table, or an owner-authored
per-hypothesis disposition referring to it. Review each item against this
matrix; retain unresolved items with explicit scope/reasons. Only after that
gate is recorded can the milestone be closed and `current_milestone`
advanced. No private reviewer content is required to be published.
The demo script and failure-mode scope are in the example README and
`M2_BOUNDARY_COMPLETION.md`; the E1/E2/E3 gap is the next-question input.
