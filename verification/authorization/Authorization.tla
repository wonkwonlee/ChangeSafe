-------------------------- MODULE Authorization --------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Bug, Tier
ASSUME Bug \in {"none", "volatile-use", "new-grant-on-retry",
                "skip-object", "storage-fail-open", "consume-dry-run"}
ASSUME Tier \in {"protected", "default"}

\* One immutable reviewed UPDATE, two possible actors, two grant identities.
\* Hashes/signatures are abstract equality/authenticity, not cryptographic proofs.
VARIABLES gate, intent, receipt, grants, delivered, used, admissions,
          unbound, bypasses, dryRuns, issuerUp, verifierUp, storageUp,
          now, activePolicy
vars == <<gate, intent, receipt, grants, delivered, used, admissions,
          unbound, bypasses, dryRuns, issuerUp, verifierUp, storageUp,
          now, activePolicy>>

Init == /\ gate = "pending" /\ intent = 0 /\ receipt = FALSE
        /\ grants = {} /\ delivered = {} /\ used = {}
        /\ admissions = 0 /\ unbound = FALSE /\ bypasses = 0 /\ dryRuns = 0
        /\ issuerUp = TRUE /\ verifierUp = TRUE /\ storageUp = TRUE
        /\ now = 0 /\ activePolicy = 1

Gate == /\ gate = "pending"
        /\ gate' \in {"pass", "block"}
        /\ UNCHANGED <<intent, receipt, grants, delivered, used, admissions,
                       unbound, bypasses, dryRuns, issuerUp, verifierUp,
                       storageUp, now, activePolicy>>

FreezeIntent(a) == /\ issuerUp /\ gate = "pass" /\ intent = 0
                   /\ intent' = a
                   /\ UNCHANGED <<gate, receipt, grants, delivered, used,
                                  admissions, unbound, bypasses, dryRuns,
                                  issuerUp, verifierUp, storageUp, now, activePolicy>>
\* Atomic receipt append follows durable intent. Separate action exposes crash window.
CommitReceipt == /\ issuerUp /\ storageUp /\ intent # 0 /\ ~receipt
                 /\ receipt' = TRUE
                 /\ UNCHANGED <<gate, intent, grants, delivered, used, admissions,
                                unbound, bypasses, dryRuns, issuerUp, verifierUp,
                                storageUp, now, activePolicy>>
\* Real code derives one id from the trusted receipt, including retry recovery.
StoreGrant == /\ issuerUp /\ storageUp /\ receipt /\ grants = {}
              /\ grants' = {1}
              /\ UNCHANGED <<gate, intent, receipt, delivered, used, admissions,
                             unbound, bypasses, dryRuns, issuerUp, verifierUp,
                             storageUp, now, activePolicy>>
Deliver(g) == /\ issuerUp /\ g \in grants /\ g \notin delivered
              /\ delivered' = delivered \cup {g}
              /\ UNCHANGED <<gate, intent, receipt, grants, used, admissions,
                             unbound, bypasses, dryRuns, issuerUp, verifierUp,
                             storageUp, now, activePolicy>>
\* Deliberately broken recovery: same review/receipt mints a second capability.
BrokenRetry == /\ Bug = "new-grant-on-retry" /\ issuerUp /\ receipt
               /\ grants = {1} /\ grants' = {1, 2}
               /\ UNCHANGED <<gate, intent, receipt, delivered, used, admissions,
                              unbound, bypasses, dryRuns, issuerUp, verifierUp,
                              storageUp, now, activePolicy>>

Exact == [actor |-> intent, operation |-> "UPDATE", resource |-> 1,
          object |-> 2, prior |-> 1, uid |-> 1, policy |-> 1, authentic |-> TRUE]
\* Each attacker changes one field; no arbitrary command or policy interpreter.
Requests == {Exact, [Exact EXCEPT !.actor = 3],
             [Exact EXCEPT !.operation = "CREATE"], [Exact EXCEPT !.resource = 2],
             [Exact EXCEPT !.object = 3], [Exact EXCEPT !.prior = 2],
             [Exact EXCEPT !.uid = 2], [Exact EXCEPT !.policy = 2],
             [Exact EXCEPT !.authentic = FALSE]}
Bound(r) == /\ r = Exact /\ activePolicy = 1 /\ now < 2 /\ intent # 0
Accepted(r) == /\ (r = Exact \/ (Bug = "skip-object" /\ r = [Exact EXCEPT !.object = 3]))
               /\ activePolicy = 1 /\ now < 2 /\ intent # 0

Admit(g, r) == /\ verifierUp /\ g \in delivered /\ g \notin used
               /\ Accepted(r) /\ admissions < 2
               /\ (storageUp \/ Bug = "storage-fail-open")
               /\ used' = IF storageUp THEN used \cup {g} ELSE used
               /\ admissions' = admissions + 1
               /\ unbound' = (unbound \/ ~Bound(r))
               /\ UNCHANGED <<gate, intent, receipt, grants, delivered, bypasses,
                              dryRuns, issuerUp, verifierUp, storageUp, now, activePolicy>>
DryRun(g, r) == /\ verifierUp /\ g \in delivered /\ Accepted(r) /\ dryRuns = 0
                /\ dryRuns' = 1
                /\ used' = IF Bug = "consume-dry-run" THEN used \cup {g} ELSE used
                /\ UNCHANGED <<gate, intent, receipt, grants, delivered, admissions,
                               unbound, bypasses, issuerUp, verifierUp, storageUp,
                               now, activePolicy>>
\* Kubernetes owns Ignore; no grant exists in the minimal outage counterexample.
OutageBypass == /\ ~verifierUp /\ Tier = "default" /\ bypasses = 0
                /\ bypasses' = 1
                /\ UNCHANGED <<gate, intent, receipt, grants, delivered, used,
                               admissions, unbound, dryRuns, issuerUp, verifierUp,
                               storageUp, now, activePolicy>>
CrashIssuer == /\ issuerUp /\ issuerUp' = FALSE
               /\ UNCHANGED <<gate, intent, receipt, grants, delivered, used,
                              admissions, unbound, bypasses, dryRuns, verifierUp,
                              storageUp, now, activePolicy>>
RestartIssuer == /\ ~issuerUp /\ issuerUp' = TRUE
                 /\ UNCHANGED <<gate, intent, receipt, grants, delivered, used,
                                admissions, unbound, bypasses, dryRuns, verifierUp,
                                storageUp, now, activePolicy>>
CrashVerifier == /\ verifierUp /\ verifierUp' = FALSE
                 /\ UNCHANGED <<gate, intent, receipt, grants, delivered, used,
                                admissions, unbound, bypasses, dryRuns, issuerUp,
                                storageUp, now, activePolicy>>
RestartVerifier == /\ ~verifierUp /\ verifierUp' = TRUE
                   /\ used' = IF Bug = "volatile-use" THEN {} ELSE used
                   /\ UNCHANGED <<gate, intent, receipt, grants, delivered,
                                  admissions, unbound, bypasses, dryRuns, issuerUp,
                                  storageUp, now, activePolicy>>
ToggleStorage == /\ storageUp' = ~storageUp
                 /\ UNCHANGED <<gate, intent, receipt, grants, delivered, used,
                                admissions, unbound, bypasses, dryRuns, issuerUp,
                                verifierUp, now, activePolicy>>
Tick == /\ now < 2 /\ now' = now + 1
        /\ UNCHANGED <<gate, intent, receipt, grants, delivered, used, admissions,
                       unbound, bypasses, dryRuns, issuerUp, verifierUp,
                       storageUp, activePolicy>>
PolicyUpgrade == /\ activePolicy = 1 /\ activePolicy' = 2
                 /\ UNCHANGED <<gate, intent, receipt, grants, delivered, used,
                                admissions, unbound, bypasses, dryRuns, issuerUp,
                                verifierUp, storageUp, now>>
Next == Gate \/ (\E a \in {1, 2}: FreezeIntent(a)) \/ CommitReceipt \/ StoreGrant
        \/ (\E g \in {1, 2}: Deliver(g)) \/ BrokenRetry
        \/ (\E g \in {1, 2}, r \in Requests: Admit(g, r) \/ DryRun(g, r))
        \/ OutageBypass \/ CrashIssuer \/ RestartIssuer \/ CrashVerifier
        \/ RestartVerifier \/ ToggleStorage \/ Tick \/ PolicyUpgrade
Spec == Init /\ [][Next]_vars

TypeOK == /\ gate \in {"pending", "pass", "block"} /\ intent \in 0..2
          /\ receipt \in BOOLEAN /\ grants \subseteq {1, 2}
          /\ delivered \subseteq grants /\ used \subseteq grants
          /\ admissions \in 0..2 /\ bypasses \in 0..1 /\ dryRuns \in 0..1
          /\ unbound \in BOOLEAN /\ now \in 0..2 /\ activePolicy \in 1..2
          /\ issuerUp \in BOOLEAN /\ verifierUp \in BOOLEAN /\ storageUp \in BOOLEAN
ApprovalBeforeAuthority == (receipt \/ grants # {}) => (gate = "pass" /\ intent # 0)
OneIdentityPerReview == Cardinality(grants) <= 1
AtMostOnce == admissions <= 1
ExactAuthorization == ~unbound
ConsumptionBeforeAllow == admissions <= Cardinality(used)
NoDryRunConsumption == Cardinality(used) <= admissions
NoAdmissionWithoutGrant == bypasses = 0
=============================================================================
