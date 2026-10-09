# What can authorization guarantee across failures?

Owner authorization: 2026-10-08. M3 was implemented within its one-week
cap. This is a checked model and evidence package, not formal closure of
the preceding milestone: see [M2's remaining process gate](M2_CLOSEOUT.md).

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

## Adversarial gate and remaining process work

Happy and malicious protocol paths, altered/missing artifact abstractions,
storage/verifier/issuer failure and the default upstream outage outcome are
checked by the normal/negative configurations. Actual parser, OIDC,
signature and HTTP boundary checks remain in the M2 implementation gate.
The private ten-hypothesis M0 intake still needs an owner-held disposition;
it is not reproduced or invented here. Consequently the model work is
complete and checked, but formal milestone closure remains pending that
specific evidence dependency. Next-question selection is documented in
[M4 decision](M4_DECISION.md).
