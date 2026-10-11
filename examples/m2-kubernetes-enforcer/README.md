# M2 Kubernetes admission reproduction

Current source: authenticated HTTP issuance, persistent grant use-state and
native routing guards. The scope/migration contract is in
[boundary completion](../../docs/M2_BOUNDARY_COMPLETION.md), and the exit
matrix and remaining process input are in [M2 close-out](../../docs/M2_CLOSEOUT.md).

## Reproduce

Requires Node 22/npm 10.9.8, kind, kubectl, Docker and OpenSSL:

```bash
bash examples/m2-kubernetes-enforcer/kind-repro.sh
```

This opt-in driver builds the enforcer, creates a disposable kind cluster,
generates ephemeral demo signing/TLS keys, deploys the enforcer with a
persistent SQLite volume, registers the webhooks and routing guards, and
runs real API requests. It deletes the cluster on exit; `KEEP_CLUSTER=1`
retains it. This is a test harness, not a product execution capability.
The latest run writes `demo-transcript.txt`; CI uploads it as an artifact.
Do not commit generated private keys or treat an old transcript as a new run.

## Retained evidence

[2026-10-08 CI transcript](evidence/2026-10-08-ci-transcript.txt) is retained
unchanged from run [37728132291](https://github.com/wonkwonlee/ChangeSafe/actions/runs/37728132291)
on PR #76 head `bc15a3166d8bb2d79c21e7b9e9f6995595138a40`.
Its SHA-256 is
`51eb06106a2a9460da40824bbb8b16519fb68e93bdd8376c9a77647fce35ccc8`.
The original `demo-transcript.txt` in git is the pre-extension run and is
historical. The current local environment has no Docker/kind; the retained
CI run, rather than a new local run, is the live boundary evidence.

## 90-second walkthrough

After setup, show these transcript sections or run the driver's same steps:

| Time | Demonstration | Evidence |
| --- | --- | --- |
| 0–20s | Authenticated review/approval issues a server-bound grant; same-intent retry recovers it | `m2-kind-authorize.test.ts` passes against actual cluster objects |
| 20–40s | Server dry-run succeeds, then actual request succeeds with the same grant | two successful patch responses; replicas become 4 |
| 40–55s | Reuse the grant with replicas 5 | explicit object-hash DENY; replicas remain 4 |
| 55–75s | Stop verifier; attempt protected/default changes | protected Fail denies; default Ignore admits |
| 75–90s | Explain the boundary | ALLOW is E1; neither receipt nor grant attests E2/E3 |

Setup also proves protected namespace downgrade and Scale-subresource DENY.
The kind test reads API-server `spec.replicas` as a demonstration assertion;
that read is not a signed persistence/effect attestation and no rollout
completion claim is made.

## Enforcement and failure matrix

| Request/failure | Protected namespace | Default namespace |
| --- | --- | --- |
| Supported parent CREATE/UPDATE, valid grant | ALLOW after durable consumption; dry-run skips consumption | Same while verifier reachable |
| Missing/malformed/substituted grant, expired/drifted binding | Explicit DENY | Explicit DENY while verifier reachable |
| Consumption storage error | Explicit HTTP 200 DENY | Explicit HTTP 200 DENY, not an Ignore outage |
| Verifier unreachable | API server fails closed (`Fail`) | API server skips verifier (`Ignore`); no unconditional authorization guarantee |
| Namespace deprotection/deletion | Native policy denies ordinary requests | Unprotected namespaces retain ordinary behavior |
| Deployment/StatefulSet Scale or HPA write | Native policy denies; reviewed parent UPDATE is the supported replica-change path | Ordinary behavior; no Scale grant contract |
| DELETE or unsupported workload kinds | Not registered by this enforcer | Not registered by this enforcer |

Protected routing uses the namespace label `changesafe.dev/tier: protected`,
not the workload's `changesafe.dev/protected` annotation. The latter is a
separate deterministic spec-freeze policy, so the benign scale-up example
uses namespace routing without that annotation. Apply `routing-guards.yaml`
before handing out workload credentials; trusted administrators own RBAC,
admission configuration, signing keys and any maintenance deprotection.

The grant is carried in the `changesafe.dev/grant` annotation; only that
annotation is excluded from its object hash. The runnable enforcer requires
`GRANT_USES_DB` and binds the bundled policy version unless explicitly
overridden. Multi-process use requires one shared reliable local SQLite
file. Cross-node HA, backup-restore replay protection, certificate rotation,
production ingress/CNI behavior and E3 reconciliation are not verified here.
