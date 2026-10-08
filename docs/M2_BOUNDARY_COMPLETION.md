# Reviewed authorization through retries and admission routing

This is an unreleased `main` extension of M2, following the owner's approval
on 2026-10-07. It is not part of the published v0.5.0 artifacts. The design
and four-question filter are in [the plan](M2_BOUNDARY_COMPLETION_PLAN.md).
The original M2 note below describes the earlier implementation; this note
supersedes its open-gap descriptions for CS-ADV-004/006/007/009/013/018.

## HTTP contract and server-derived binding

`POST /reviews` accepts `domainId: "kubernetes"`, source kind
`kubernetes-snapshot`, and input content `{ snapshot, manifestText }`. The
snapshot is the raw, read-only collector shape, preserving full spec,
metadata and the prior UID. The manifest is the exact candidate object;
review admission-defaulted objects where possible. No separate proposal
is accepted: the server derives it mechanically. The receipt input hash
binds the complete immutable bundle; the proposal hash binds the derived
policy proposal. Other domains' hash contracts remain unchanged.

`POST /reviews/:id/decisions` accepts grant preferences only:
`{ authorizedActor, authorizedActorUid?, expiresAtUtc }`. Operation,
resource, before/after hashes and resource UID come from the stored review,
never the decision body. One grant supports one manifest/resource operation.
Multiple resources require separate reviews; unsupported kinds, malformed
artifacts, missing UPDATE UID, and domains without an issuance contract are
refused before a decision is committed. Direct service issuance requires
both the immutable request and a trusted, ledgered approved receipt.

This replaces the experimental caller-asserted grant request contract.
Previously accepted operation/resource/hash fields now receive 422. No
public npm grant API was shipped. Existing Network/Terraform reviews and
historical rows remain readable. Kubernetes receipt hashing in the server
now binds original artifacts, rather than just the lossy policy projection;
use the self-hosted receipt-proof path for that source boundary.

## Routing controls

Apply `examples/m2-kubernetes-enforcer/routing-guards.yaml` before handing
out workload credentials. Kubernetes v1 ValidatingAdmissionPolicy support
is required; failure to install the controls is a deployment failure, not
an optional reduction in protection. Admission controllers/policies, signing
keys and RBAC are controlled by trusted administrators.

- A protected Namespace cannot lose/change its protection label or be
  deleted through ordinary namespace API requests. Other labels remain editable.
  Administrative deprotection requires a deliberate policy/RBAC maintenance
  procedure; no automatic bypass identity is bundled.
- Deployment/StatefulSet Scale writes in protected namespaces are denied,
  including `kubectl scale`, direct Scale PATCH and HPA-driven writes. Replica
  changes use a reviewed grant on the parent CREATE/UPDATE path. HPA in these
  namespaces is **unsupported**. Unprotected namespaces retain existing behavior.
- DELETE on workloads and other resource kinds remain outside this enforcer.
  This is scoped admission enforcement, not cluster-wide protection.

These policies do not depend on webhook availability or namespaceSelector.
The existing Fail/Ignore experiment remains for parent resources. Denying
Scale is deliberately narrower than claiming a Scale authorization contract
that the system does not yet implement.

## Durable issuance, recovery and single use

The review database holds immutable decision/grant intent and the issued
SignedGrant in separate tables. Receipt remains decision evidence. Intent
is frozen before receipt issuance; signing follows a committed receipt;
the signed grant is stored before the response. The same POST with the same
owner, decision and preferences recovers the same grant after response loss,
or completes issuance after a receipt/resolution commit and a storage failure.
Conflicting preferences, a different owner, or adding a grant to an already
completed grantless decision are refused. Grant id derives from receipt id:
recovery does not create a second capability identity. A stored grant is
checked against its trusted signing key and reviewed bindings on read.

The runnable enforcer requires `GRANT_USES_DB`. Atomic SQLite unique inserts
record successful admissions across restarts and independent connections.
Library callers can still explicitly use the in-memory test registry; that
is not the deployed durability claim. The example uses one replica and a
persistent ReadWriteOnce volume. Multiple replicas must use **one shared
SQLite file with reliable local filesystem locking** (e.g. same-node volume),
never per-replica files or an unvalidated network filesystem. Cross-node HA
is not claimed. Preserve/back up both review and use-state databases.

Storage errors after a valid admission check return explicit HTTP 200 DENY,
so `failurePolicy: Ignore` cannot turn a consumption error into ALLOW.
Dry-run validates the grant without consuming it. Actual ALLOW consumes it
before API server persistence; later API rejection still burns that grant.
Consumption records are retained; disk grows with authorized admissions.
Revocation, garbage collection, disaster-recovery replay protection and
cross-node shared storage remain outside this pass.

## Evidence and claim limits

Authenticated HTTP tests cover intake → approval → server-derived grant →
admission verification, object substitution, cross-domain issuance, caller
bindings, CREATE/UPDATE, response recovery and injected storage failure.
SQLite tests cover independent connections, restart, conflicting intent,
immutable rows and corrupt payloads. Enforcer tests cover storage-error DENY
and non-consuming dry-run in addition to the existing attack suite.

The kind driver now obtains its grant through the authenticated HTTP route
with an ephemeral test IdP that signs real tokens, and persists receipts/reviews.
It also attempts namespace downgrade and protected Scale bypass before the
ALLOW/DENY/outage experiment. CI runs it and uploads a fresh transcript.
The checked-in original `demo-transcript.txt` is historical evidence for the
pre-extension M2 run, not evidence for this new path.

ALLOW binds the reviewed authorization to E1. It is not an E2 persistence
attestation or an E3 rollout/effect claim. Full-object hashing may deny
legitimate objects changed by API defaulting or mutation; it does not silently
weaken binding to avoid those denials. M2 is not closed by this change.
