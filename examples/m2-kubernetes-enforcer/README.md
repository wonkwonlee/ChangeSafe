# M2 Kubernetes Enforcer — kind reproduction

Two ValidatingWebhookConfigurations implement Spec Decision 4's two-tier
failurePolicy:

- `webhook-protected.yaml` (`failurePolicy: Fail`) — every CREATE/UPDATE
  of a **Deployment, StatefulSet, DaemonSet, or Service** in a **namespace
  labeled `changesafe.dev/tier: protected`**. Both conditions are exact:
  the webhook's `rules` register only those four kinds, so Pods, Jobs,
  ConfigMaps, Secrets, and every other kind in the same namespace never
  invoke either webhook at all — they are not grant-gated, healthy enforcer
  or not. And the namespace label is the routing condition, and the only
  one: Kubernetes' `objectSelector` matches
  labels, not annotations, so the `changesafe.dev/protected: "true"`
  annotation the `K8S_PROTECTED_RESOURCE` policy tracks cannot route a
  request by itself (see "Two open problems" below). An annotated workload
  in an *unlabeled* namespace is therefore **not** fail-closed — it routes
  to the default webhook and is admitted if the enforcer is down. Operators
  must label the namespaces that hold protected resources.
- `webhook-default.yaml` (`failurePolicy: Ignore`) — everything else.

**Status: run and verified against a real kind cluster** (`kind v0.32.0`,
node image `kindest/node:v1.36.1`). `kind-repro.sh` builds the packages,
builds and loads the enforcer image, stands up the cluster, deploys the
enforcer behind TLS, registers both webhooks, and runs all three demo steps
below against a real Kubernetes API server — no piece of it is simulated.
The full transcript from an actual run is in `demo-transcript.txt` in this
directory; the excerpts below are taken directly from it.

## Two open problems, resolved empirically

**1. How does a grant physically attach to a `kubectl apply`/`kubectl
patch` request?** `kubectl` has no way to attach an out-of-band HTTP
header, and admission webhooks are called by the API server, not by
`kubectl` — so a header-based mechanism was never going to work against a
real cluster regardless of what the client sends. The API server always
forwards the complete object being admitted (metadata, annotations
included) inside the `AdmissionReview` request body it POSTs to the
webhook. The grant therefore travels as a base64-encoded, JSON-serialized
`SignedGrant` in a `changesafe.dev/grant` annotation on the object itself.
`packages/kubernetes-enforcer/src/main.ts`'s `readGrantFromAnnotation`
implements this; `EnforcerServerOptions.readGrant` in `src/server.ts` was
extended to also receive the already-parsed `AdmissionReviewRequest` (in
addition to the raw `IncomingMessage`, kept for test doubles) so a real
`readGrant` implementation can read `review.request.object` — this does not
break the Task 9 test suite, since JavaScript callbacks silently ignore
extra arguments and `server.test.ts`'s header-reading test doubles only
declare one parameter.

This surfaced a second, non-obvious problem: a grant's `objectSha256` is
computed against the object *before* the grant annotation is attached to
it. Once attached, hashing the object naively (annotation included) would
make the grant invalidate its own hash the instant it was embedded — an
object can never be self-consistent with a grant that names its own future
hash. `verify.ts`'s `objectHashOf` now excludes the `changesafe.dev/grant`
annotation itself before hashing (see `GRANT_ANNOTATION` in `verify.ts`),
matching what the issuing side hashes (an object that has no grant
annotation yet). This was found and fixed empirically, by round-tripping a
real grant through the enforcer container and watching the object-hash
comparison fail until the annotation was excluded on both sides.

**2. `objectSelector` cannot match an annotation directly.** Confirmed:
Kubernetes' `objectSelector` matches labels only. Rather than add a
mutating controller to mirror an annotation onto a label (extra moving
part, extra failure mode, and a second component that itself would need
`failurePolicy` reasoning), the routing split is done by **namespace**
instead: `webhook-protected.yaml` uses `namespaceSelector: matchLabels:
{changesafe.dev/tier: protected}`, and `webhook-default.yaml` uses the
complementary `matchExpressions: NotIn [protected]`. Namespace labels *are*
selectable by `objectSelector`'s cousin `namespaceSelector`, so this is a
real Kubernetes mechanism, not a workaround — the tradeoff is that the
protected/default split becomes a per-namespace convention (a cluster
operator labels which namespaces hold protected resources) rather than a
per-object one. This was verified directly: `kind-repro.sh` creates
`changesafe-protected-demo` (labeled `changesafe.dev/tier: protected`) and
`changesafe-default-demo` (unlabeled), and the demo below shows each
routing to its intended webhook.

A third, smaller thing the kind cluster caught that a header-only test
suite could not: Kubernetes' admission webhook client appends its own query
string (`?timeout=10s`) to the configured path. `server.ts`'s path check
used to compare `request.url` for exact equality against `/validate`,
which a real admission call always failed (returning 404, which the API
server reports as the generic "the server could not find the requested
resource"). Fixed by comparing only the path portion.

## Reproducing

Requires `kind`, `kubectl`, `docker`, `node` (22.x), and `openssl`.

```bash
./kind-repro.sh
```

The script is self-contained: it builds `@changesafe/core`,
`@changesafe/domain-kubernetes`, and `@changesafe/kubernetes-enforcer`;
builds the enforcer's `Dockerfile` (context is the repo root, since this is
an npm-workspaces monorepo — see the Dockerfile's own comment); creates a
`kind` cluster named `changesafe-m2`; generates a local self-signed CA/TLS
cert pair and a demo Ed25519 grant-signing key pair; deploys the enforcer
(`enforcer-deployment.yaml`) and both webhook configurations; and runs the
three demo steps below, failing loudly (non-zero exit) if any step's
outcome doesn't match what's documented here. It deletes the kind cluster
on exit (`KEEP_CLUSTER=1 ./kind-repro.sh` to keep it for follow-up
debugging) and writes the full transcript to `demo-transcript.txt`.

## 90-second demo

### 1. Authorize and exercise correctly (ALLOW)

A grant is issued for a benign Deployment replica change (`3` → `4`) in the
`changesafe-protected-demo` namespace, computed against the exact object
the grant authorizes, then attached via the `changesafe.dev/grant`
annotation and applied with `kubectl patch`:

```
$ kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file=step1-patch.json
deployment.apps/web patched
web replicas after step 1: 4 (expected 4)
```

### 2. Reuse the same grant against a modified object (DENY)

The identical signed grant (still authorizing `replicas: 4`) is attached to
a patch requesting `replicas: 5` instead:

```
$ kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file=step2-patch.json
Error from server: admission webhook "protected.enforcer.changesafe.dev" denied the request: requested object does not match the object the grant authorized
web replicas after step 2: 4 (expected still 4 — the denied patch did not apply)
```

### 3. Fail-closed vs. fail-open when the enforcer is unreachable

The enforcer is scaled to 0 replicas (simulating an outage), then the same
kind of change is attempted against a resource in the protected namespace
and, separately, an unprotected one:

```
$ kubectl -n changesafe-system scale deploy/changesafe-enforcer --replicas=0
deployment.apps/changesafe-enforcer scaled
$ kubectl -n changesafe-protected-demo patch deployment web --type=merge -p '{"spec":{"replicas":6}}'
Error from server (InternalError): Internal error occurred: failed calling webhook "protected.enforcer.changesafe.dev": failed to call webhook: Post "https://changesafe-enforcer.changesafe-system.svc:8443/validate?timeout=10s": dial tcp 10.96.252.95:8443: connect: connection refused
$ kubectl -n changesafe-default-demo patch deployment web --type=merge -p {"spec":{"replicas":6}}
deployment.apps/web patched
changesafe-default-demo/web replicas: 6 (expected 6 — allowed, failurePolicy: Ignore)
changesafe-protected-demo/web replicas: 4 (expected still 4 — blocked, failurePolicy: Fail)
```

The protected resource stayed at its pre-outage value (`4`) — the API
server itself refused the request because `failurePolicy: Fail` treats an
unreachable webhook as a denial. The unprotected resource in the default
namespace applied normally (`6`) — `failurePolicy: Ignore` treats the same
unreachable webhook as "skip this check."

The full unedited transcript, including the cluster bring-up, image build,
and webhook registration steps, is in `demo-transcript.txt`.

**Explicit non-claim, per the spec:** `ALLOW` in this demo means only that
the admission request matched its grant — it is not proof the Deployment
controller reconciled successfully or that the running pods reflect the new
spec. This reproduction does not wait for or assert on rollout completion;
it asserts only on `spec.replicas` as recorded by the API server, which is
what the admission decision itself governs.

## What is and is not verified

Verified for real, against a live `kind` cluster and a live enforcer
container, in a single unattended run of `kind-repro.sh`:

- Building and loading the enforcer Docker image.
- TLS-terminated `ValidatingWebhookConfiguration` registration and the API
  server successfully calling the webhook over HTTPS with a self-signed CA.
- The annotation-based grant-attachment mechanism, end to end, including
  the object-hash-must-exclude-its-own-annotation fix.
- Namespace-scoped routing between the two webhook tiers.
- All three 90-second-demo outcomes (ALLOW, DENY on object substitution,
  and the fail-closed/fail-open split on verifier-down).

Not verified, and out of scope for this reproduction: the enforcer's
behavior on a real production ingress/CNI setup other than kind's
node-local docker networking; TLS certificate rotation; multi-replica
enforcer behavior under concurrent admission load; and — as stated above —
whether the Deployment controller actually reconciles an allowed change.
