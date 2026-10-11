# What can authorization guarantee across failures?

Owner authorization: 2026-10-08. M3 was implemented within its one-week
cap. **M3 formal verification is complete and the milestone is closed** for
this bounded protocol model. The owner explicitly delegated official M2/M3
completion on 2026-10-08. [M2 close-out](M2_CLOSEOUT.md) and the
[inherited-question review](M0_RETROSPECTIVE_REVIEW.md) record the preceding gate.
“Formal verification” here means exhaustive safety-invariant checking of the
finite TLA+ model, not a refinement proof of the TypeScript implementation.

Decision filter: A yes (state the exact authorization boundary); B yes
(invariants, bounded model checking and counterexample interpretation);
C yes (explain crash windows and an explicit failed overclaim); D yes
(an ALLOW and a successful durable consumption still do not describe E2).
No frozen technology or new domain is introduced.

## Checks and results

The runnable model is [Authorization.tla](../verification/authorization/Authorization.tla).
[Reproduction](../verification/authorization/README.md) uses pinned TLC,
and [the checked run](../verification/authorization/results/results.json)
binds results to the model SHA-256. The normal protected configuration
explored 816 distinct states; the default configuration explored 1,632.
No counterexample found under attack model bounded immutable UPDATE review,
one-field request substitutions, interleaved outages, expiry, policy drift,
dry-run, retry delivery and shared durable consumption.

| Invariant | Model statement | Concrete code / regression evidence |
| --- | --- | --- |
| Approval before authority | No receipt/grant without a passed gate and human intent | `packages/server/src/decisions.ts`, `packages/server/tests/reviews.test.ts`: blocked approval refused |
| One identity per review | At most one durable grant id for one receipt/review | `grant-journal.ts`, `decisions.ts`: stable receipt-derived id; concurrent/recovery tests |
| At most once | At most one actual authorized admission for that review | `sqlite-use-state.ts`: atomic unique insert; connection/process/restart tests |
| Exact authorization | No verifier ALLOW on a substituted actor/operation/resource/object/prior state/incarnation/signature or expired/drifted policy | `grant-binding.ts`, `verify.ts`, verifier and HTTP issuance suites |
| Consumption before ALLOW | Actual ALLOW cannot precede durable use-state | `server.ts`: successful consume precedes response; storage-error DENY test |
| No dry-run consumption | Dry-run cannot burn an actual-use entitlement | `server.ts`, `server.test.ts`, live kind server-dry-run then actual admission |
| Protected outage boundary | Protected modeled requests cannot bypass a grant through verifier outage | `webhook-protected.yaml`, `routing-guards.yaml`, kind outage experiment |

## Counterexamples that must stay reproducible

These switches deliberately break the **model**, not production code.

| Switch | Minimal behavior | Required failure |
| --- | --- | --- |
| Volatile use-state | approve → grant → ALLOW → crash/restart clearing uses → ALLOW again | `AtMostOnce` |
| New id on retry | approve → receipt → grant 1 → retry mints grant 2 | `OneIdentityPerReview` |
| Skip object binding | grant for object 2 → allow substituted object 3 | `ExactAuthorization` |
| Storage fail-open | valid request → storage unavailable → ALLOW without consume | `ConsumptionBeforeAllow` |
| Consume dry-run | dry-run → used record without actual admission | `NoDryRunConsumption` |
| Default-tier global claim | verifier outage → default admission bypass, without any grant | `NoAdmissionWithoutGrant` |

The last case is not an injected defect. It demonstrates the actual
availability tradeoff of `failurePolicy: Ignore`: there is no unconditional
cluster-wide authorization guarantee. A valid denial from a reachable
verifier remains a denial on both tiers; an unreachable verifier follows
the API server's tier configuration.

## Model assumptions and limits

- Review artifacts, receipt/intent rows and trusted administrators are
  immutable/trusted. The model abstracts first-write and receipt verification
  as atomic actions; concrete journal/hash/signature tests check their code.
- Hash comparison and signature authenticity are abstract predicates. This
  is not a proof of collision resistance or Ed25519 implementation.
- Actor equality represents the configured binding. If the issuer omits
  `authorizedActorUid`, the implementation binds a username, not that
  identity's lifetime. The model does not strengthen that optional contract.
- The finite model covers UPDATE, not every CREATE field constraint,
  multi-review histories or arbitrary manifests. Actual CREATE/schema cases
  are exercised in the implementation suite. Rejected/malformed/missing
  requests are stuttering denials in the model, not a model of Zod parsing.
- Shared SQLite consumption is represented by one atomic set insertion;
  corruption, database rollback/restore, cross-node filesystem behavior,
  signing-key compromise and routing-policy removal by trusted admins are
  outside this model. Each would need a new attack model.
- Time is monotonic and bounded, with issue time 0 and expiry 2. No clock
  synchronization, network latency bound, fairness or eventual completion
  is proved. A grant can expire before a retry reaches its caller.
- A dry-run checks authorization without consulting/consuming actual-use
  records, matching the current server. It does not reserve admission.
- These are protocol-model results. No refinement proof connects all
  TypeScript executions to TLA+. The mapping above and implementation tests
  provide supporting engineering evidence, not equivalence proof.
- The model records actual **enforcer ALLOWs** and default-tier bypasses.
  Neither is an E2 persistence record or an E3 observed effect.

## Adversarial exit matrix and closure

| Required gate | Exercised evidence | Result |
| --- | --- | --- |
| Happy path | Normal protected/default configurations; M2 issuance/admission tests | Scoped protocol invariants hold |
| Malicious path | Broken object/retry/restart transitions and request substitutions | Expected invariant violations; normal variants deny substitutions |
| Malformed input | M2 parser/HTTP/OIDC suites | Actual malformed contracts rejected; parsing is abstracted in the model |
| Receipt/grant tampering | M2 signature/journal tests; model authenticity substitution | Concrete tampering refused; authenticity modeled as an assumption |
| Missing artifact | No receipt/grant/delivery states in Init/Next; M2 missing-grant tests | No protected authorized ALLOW without delivered authority |
| Component failure | Issuer/verifier crashes, storage toggle, broken storage/restart cases | Durable consumption/order required; six negative checks produce named failures |
| Unexpected upstream output | Default-tier outage bypass, M2 raw-schema tests | Global default-tier claim fails as expected; unsupported raw input denies |
| Open M0 hypotheses | [R-01–R-11 retrospective disposition](M0_RETROSPECTIVE_REVIEW.md) | Reviewed; scope exclusions and original-intake uncertainty retained |

The implementation and CI model check completed within one day of the
2026-10-08 authorization, inside the one-week hard cap. The pinned checker,
model/config digests, state counts, exit codes and complete counterexample
traces are committed in the linked results package. CI run 37878264318 checks
the exact snapshot and publishes artifact `11592914416`. Closure verification
reran both normal configurations and all six negative cases successfully.

No counterexample found under attack model bounded immutable UPDATE review,
one-field request substitutions, interleaved outages, expiry, policy drift,
dry-run, retry delivery and atomic durable consumption. The limits above are
part of the completed result, including no CREATE model, no unbounded/multi-review
or liveness proof, no TypeScript refinement proof, and no E2/E3 attestation.
Those limits are not removed by milestone closure. The next question is
[M4 observation](M4_DECISION.md); its implementation remains future work.
