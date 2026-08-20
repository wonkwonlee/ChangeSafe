# M2 Kubernetes Enforcer — kind reproduction

Two ValidatingWebhookConfigurations implement Spec Decision 4's two-tier
failurePolicy:

- `webhook-protected.yaml` (`failurePolicy: Fail`) — resources the
  `K8S_PROTECTED_RESOURCE` policy already tracks via the
  `changesafe.dev/protected: "true"` annotation.
- `webhook-default.yaml` (`failurePolicy: Ignore`) — everything else.

**Open caveat, resolved empirically below:** Kubernetes' `objectSelector`
matches labels, not annotations. See `kind-repro.sh` for how this
repository's kind reproduction routes protected resources to the `Fail`
webhook. Do not assume the YAML above is final until that script's run
confirms the selector approach it settled on.

## Reproducing

1. `kind create cluster`
2. Build and load the enforcer image: `docker build -t changesafe-kubernetes-enforcer:dev packages/kubernetes-enforcer && kind load docker-image changesafe-kubernetes-enforcer:dev`
3. `./kind-repro.sh` — deploys the enforcer, applies both webhook
   configurations, then runs the three demo steps below.

## 90-second demo

1. **Authorize and exercise correctly (ALLOW):** issue a grant for a benign
   Deployment replica change via the server's decision endpoint, apply it
   with the matching grant attached — allowed.
2. **Reuse the same grant against a modified object (DENY):** apply a
   *different* replica count using the same grant — denied, object hash
   mismatch.
3. **Fail-closed when the verifier is unavailable on a protected resource:**
   scale the enforcer deployment to 0, attempt to modify a resource
   annotated `changesafe.dev/protected: "true"` — denied by
   `failurePolicy: Fail`. Attempt the same against an unprotected resource —
   allowed by `failurePolicy: Ignore`.

Record actual command transcripts and outcomes here after running the
script, replacing this placeholder paragraph — this file itself becomes the
milestone's kind-cluster-reproduction and failure-mode-document deliverable
once filled in with real output. Also state explicitly here (per the spec's
"Explicit non-claims" section): `ALLOW` in this demo means only that the
admission request matched its grant — it is not proof the Deployment
controller reconciled successfully or that the running pods reflect the new
spec.

**Status: not yet run.** `kind-repro.sh` is currently a skeleton that
deliberately exits non-zero — the reproduction against a real kind cluster
(Step 4 of the M2 task plan) has not been performed yet. Nothing in this
demo section above is a real transcript.
