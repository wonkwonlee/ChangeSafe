# Can the reviewed change survive issuance, retries, and admission routing?

Owner authorization: 2026-10-07, approved all three review priorities and
implementation, review, commit, and push. This extends M2; it does not close
M2 or authorize npm publication.

Decision filter: A yes (bind the reviewed change, not caller assertions);
B yes (crash recovery and SQLite atomic consumption); C yes (reproducible
HTTP/admission failures); D yes (CS-ADV-004/006/007/009/013/018 defeat the
existing abstractions). No frozen technology or new domain is introduced.

1. Accept immutable raw Kubernetes snapshots and manifest text through the
   durable HTTP contract. Derive a single-resource grant server-side and
   verify its source against a ledgered approved receipt. Reject grants for
   domains without an issuance contract and caller-selected bindings.
2. Protect namespace tier downgrades with a fail-closed native admission
   policy independent of the namespace selector. Explicitly deny protected
   Scale writes; authorized replica changes use the reviewed parent UPDATE
   path. HPA in protected namespaces is deliberately unsupported rather than
   silently bypassing the gate. Bootstrap these controls before handing out
   workload credentials; cluster administration remains trusted.
3. Persist immutable decision/grant intent before receipt issuance, and store
   the signed grant before responding. Retry the original intent to recover
   the same grant through crash windows. Use SQLite atomic single-use records
   in the enforcer; all replicas must share one filesystem with reliable
   SQLite locking. No distributed ledger or infrastructure execution.

Checks: hostile cross-domain/substituted bindings, real authenticated HTTP
intake/decision plus enforcer, crash/retry and conflicting intent, concurrent
consumption across independent connections and restart, malformed/storage
failure deny, existing corpus, typecheck/lint/build/e2e. Record unavailable
cluster tooling honestly; never reuse an old transcript as new evidence.
