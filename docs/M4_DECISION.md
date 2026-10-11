# What evidence can connect an admitted request to stored state?

Owner authorization: 2026-10-08 to complete the current plan and select
the next question from M2/M3 results. This records a direction and bounded
experiment design; it does not claim an implemented E2/E3 observer.

## Decision

Choose **effect verification, starting with the E1 → E2 gap** as the next
research direction after [M2](M2_CLOSEOUT.md) and [M3](M3_GUARANTEES.md) closure.
This opens M4 planning; the observer remains unimplemented. The M3 storage and
dry-run counterexamples explain why consumption has to precede ALLOW, but
that safe ordering burns a grant even if Kubernetes later rejects
persistence. A correct enforcer cannot resolve that ambiguity by itself.

Decision filter: A yes (permission versus observed consequence); B yes
(causal correlation, optimistic concurrency and uncertain outcomes);
C yes (a bounded admission/storage failure story); D yes (receipts/grants
cannot represent an observation of persisted state without overclaiming).

| Candidate | Disposition | Reason from current results |
| --- | --- | --- |
| E1 → E2 observation | Select for next scoped experiment | Single-use ALLOW and actual storage are demonstrably different stages |
| Generalize to arbitrary agent actions | Defer | Would broaden the action surface before resolving the demonstrated gap |
| Deeper Kubernetes authority (DELETE/HPA/HA/revocation) | Retain as scope limits | Each needs its own counterexample/design; not required to explain the present E1/E2 uncertainty |

## Proposed experiment boundary

Keep observation separate from `ChangeReceipt` and `AuthorizationGrant`.
Start with a read-only prototype and recorded offline observations; no
execution endpoint and no new domain. Candidate evidence: admission request
uid, grant id, resource identity/incarnation, canonical target hash,
observation time and resource version. Determine experimentally which
bindings are actually available and which distinguish coincidental state
equality from evidence of the admitted write. Do not adopt this as a schema
before the experiment answers that question.

Compare four paths: admitted and stored; admitted but downstream persistence
rejected; stored then overwritten/recreated; observation unavailable or
stale. The output must permit **unknown** rather than converting absent
evidence into success or failure. A read of an equal desired spec alone
does not establish that this particular admission caused it.

Exit deliverables for the future bounded experiment: a reproducible
counterexample to naive hash-only correlation, an observation contract with
explicit unknown states, evidence fixtures, and a technical note stating
which claims remain unsupported. Rollout health and E3 realization remain
outside that first experiment. Its implementation is not added to this
release; the current approved work was selection of the M4 question.
