#!/usr/bin/env bash
# examples/m2-kubernetes-enforcer/kind-repro.sh
#
# Manual/local reproduction script — not run in CI. Requires kind, kubectl,
# docker, node, and openssl. Builds the enforcer from this checkout, spins
# up a kind cluster, deploys the enforcer behind TLS, registers the two-tier
# ValidatingWebhookConfigurations, and runs the three demo steps from
# README.md against a real object. Exits non-zero on the first unexpected
# result. Cleans up the kind cluster and its scratch dir on exit (pass
# KEEP_CLUSTER=1 to skip cleanup for follow-up debugging).
set -euo pipefail

CLUSTER_NAME="changesafe-m2"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
TRANSCRIPT="${EXAMPLE_DIR}/demo-transcript.txt"

cleanup() {
  if [ "${KEEP_CLUSTER:-0}" != "1" ]; then
    kind delete cluster --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
  fi
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

: > "${TRANSCRIPT}"
log() {
  echo "$@" | tee -a "${TRANSCRIPT}"
}
run() {
  log "\$ $*"
  "$@" 2>&1 | tee -a "${TRANSCRIPT}"
}

log "=== M2 kubernetes-enforcer kind reproduction ==="
log "cluster: ${CLUSTER_NAME}"
log ""

# --- 1. Build the packages the enforcer image needs ------------------------
log "--- Building @changesafe/core, @changesafe/domain-kubernetes, @changesafe/kubernetes-enforcer ---"
(cd "${REPO_ROOT}" && npm run build -w @changesafe/core -w @changesafe/domain-kubernetes -w @changesafe/kubernetes-enforcer) \
  | tee -a "${TRANSCRIPT}"

# --- 2. Build and load the enforcer image -----------------------------------
log ""
log "--- Building the enforcer image (context: repo root, npm workspaces) ---"
run docker build -f "${REPO_ROOT}/packages/kubernetes-enforcer/Dockerfile" \
  -t changesafe-kubernetes-enforcer:dev "${REPO_ROOT}"

# --- 3. Create the cluster ---------------------------------------------------
log ""
log "--- Creating kind cluster ---"
run kind create cluster --name "${CLUSTER_NAME}"
run kind load docker-image changesafe-kubernetes-enforcer:dev --name "${CLUSTER_NAME}"

WHOAMI_USER=$(kubectl auth whoami -o jsonpath='{.status.userInfo.username}' 2>/dev/null || echo kubernetes-admin)
log "kubectl identity: ${WHOAMI_USER}"

# --- 4. TLS: self-signed CA + server cert for the enforcer Service ----------
log ""
log "--- Generating a local CA and TLS cert for the enforcer Service ---"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${WORK_DIR}/ca-key.pem" -out "${WORK_DIR}/ca-cert.pem" \
  -days 1 -subj "/CN=changesafe-m2-demo-ca" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes \
  -keyout "${WORK_DIR}/tls-key.pem" -out "${WORK_DIR}/tls.csr" \
  -subj "/CN=changesafe-enforcer.changesafe-system.svc" >/dev/null 2>&1
openssl x509 -req -in "${WORK_DIR}/tls.csr" -CA "${WORK_DIR}/ca-cert.pem" -CAkey "${WORK_DIR}/ca-key.pem" \
  -CAcreateserial -out "${WORK_DIR}/tls-cert.pem" -days 1 \
  -extfile <(printf "subjectAltName=DNS:changesafe-enforcer.changesafe-system.svc,DNS:changesafe-enforcer.changesafe-system.svc.cluster.local") \
  >/dev/null 2>&1
log "TLS cert/CA generated in ${WORK_DIR}"

# --- 5. A demo Ed25519 signing key pair for grants --------------------------
log ""
log "--- Generating a demo Ed25519 grant-signing key pair ---"
node --input-type=module -e "
import { generateSigningKeyPair } from '${REPO_ROOT}/packages/core/dist/index.js';
import { writeFileSync } from 'node:fs';
const kp = await generateSigningKeyPair();
writeFileSync('${WORK_DIR}/grant-private.pem', kp.privateKeyPem);
writeFileSync('${WORK_DIR}/grant-public.pem', kp.publicKeyPem);
console.log('publicKeyId', kp.publicKeyId);
" | tee -a "${TRANSCRIPT}"

# --- 6. Deploy the enforcer ---------------------------------------------------
log ""
log "--- Deploying the enforcer (Deployment + Service + Secrets) ---"
run kubectl apply -f "${EXAMPLE_DIR}/enforcer-deployment.yaml"
run kubectl -n changesafe-system create secret tls changesafe-enforcer-tls \
  --cert="${WORK_DIR}/tls-cert.pem" --key="${WORK_DIR}/tls-key.pem"
run kubectl -n changesafe-system create secret generic changesafe-enforcer-signing-key \
  --from-file=public-key.pem="${WORK_DIR}/grant-public.pem"
run kubectl -n changesafe-system rollout status deploy/changesafe-enforcer --timeout=60s

# --- 7. Create the two demo namespaces --------------------------------------
# webhook-protected.yaml routes by namespaceSelector on
# changesafe.dev/tier=protected (see webhook-protected.yaml's comment for
# why — objectSelector cannot match an annotation).
log ""
log "--- Creating the two demo namespaces ---"
run kubectl create namespace changesafe-protected-demo
run kubectl label namespace changesafe-protected-demo changesafe.dev/tier=protected
run kubectl create namespace changesafe-default-demo

# --- 8. Bootstrap the target Deployments BEFORE the webhooks are registered -
# Both webhook configs now intercept CREATE as well as UPDATE (CS-ADV-012),
# so creating these after registration would need a grant for the very
# first apply too — a real operator protects an ALREADY-RUNNING resource
# (matching K8S_PROTECTED_RESOURCE's own model: the changesafe.dev/protected
# annotation marks something already there), not one that never existed
# without a grant. Bootstrapping before the webhooks even exist is the
# realistic sequence, not a workaround.
log ""
log "--- Creating the demo Deployments (before the webhooks exist, so no grant is needed yet) ---"
cat > "${WORK_DIR}/web-protected.yaml" <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: changesafe-protected-demo
  annotations:
    changesafe.dev/protected: "true"
spec:
  replicas: 3
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.27
EOF
cat > "${WORK_DIR}/web-default.yaml" <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: changesafe-default-demo
spec:
  replicas: 3
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.27
EOF
run kubectl apply -f "${WORK_DIR}/web-protected.yaml"
run kubectl apply -f "${WORK_DIR}/web-default.yaml"

# --- 9. Register the two-tier ValidatingWebhookConfigurations ---------------
# Now that the baseline Deployments exist, turn on enforcement: every
# CREATE/UPDATE from here on needs a grant.
log ""
log "--- Registering webhook-protected.yaml (failurePolicy: Fail) and webhook-default.yaml (failurePolicy: Ignore) ---"
CA_B64=$(base64 < "${WORK_DIR}/ca-cert.pem" | tr -d '\n')
sed "s#<base64-ca-bundle>#${CA_B64}#" "${EXAMPLE_DIR}/webhook-protected.yaml" > "${WORK_DIR}/webhook-protected.rendered.yaml"
sed "s#<base64-ca-bundle>#${CA_B64}#" "${EXAMPLE_DIR}/webhook-default.yaml" > "${WORK_DIR}/webhook-default.rendered.yaml"
run kubectl apply -f "${WORK_DIR}/webhook-protected.rendered.yaml" -f "${WORK_DIR}/webhook-default.rendered.yaml"

# --- 10. Demo step 1 — ALLOW: issue a grant for a benign replica change,
#        attach it via the changesafe.dev/grant annotation, apply it -------
log ""
log "=== Demo step 1: ALLOW (grant matches the exact object it authorizes) ==="
kubectl -n changesafe-protected-demo get deploy web -o json > "${WORK_DIR}/web-current.json"
node --input-type=module -e "
import { importSigningKeyPair, signGrant, AuthorizationGrantSchema } from '${REPO_ROOT}/packages/core/dist/index.js';
import { normalizeRawResource, POLICY_VERSION } from '${REPO_ROOT}/packages/domain-kubernetes/dist/index.js';
// The enforcer's own hash function, imported rather than reimplemented: the
// two sides of a grant must hash identically, and a local copy of that
// computation here is exactly the drift CS-ADV-003 recorded.
import { kubernetesObjectSha256 } from '${REPO_ROOT}/packages/kubernetes-enforcer/dist/index.js';
import { readFileSync, writeFileSync } from 'node:fs';

const current = JSON.parse(readFileSync('${WORK_DIR}/web-current.json', 'utf8'));
const candidate = JSON.parse(JSON.stringify(current));
candidate.spec.replicas = 4;

const normalized = normalizeRawResource(candidate, 'ev-demo-step1');
const objectSha256 = await kubernetesObjectSha256(candidate);

const keyPair = await importSigningKeyPair(readFileSync('${WORK_DIR}/grant-private.pem', 'utf8'));
const grant = AuthorizationGrantSchema.parse({
  grantId: 'grant-step1-0001',
  receiptId: 'rcpt-step1-0001',
  authorizedActor: '${WHOAMI_USER}',
  operation: 'UPDATE',
  resource: normalized.resourceId,
  objectSha256,
  // The value the real system composes and records in receipts, not a
  // hand-written stand-in. Note the enforcer's drift check is inert in this
  // demo: EXPECTED_POLICY_VERSION is deliberately unset in
  // enforcer-deployment.yaml, so this field is carried but not compared here.
  // The drift check itself is covered by the unit suite.
  policyVersion: POLICY_VERSION,
  issuedAtUtc: new Date(Date.now() - 60000).toISOString(),
  expiresAtUtc: new Date(Date.now() + 3600000).toISOString(),
});
const signed = await signGrant(grant, keyPair);
writeFileSync('${WORK_DIR}/step1-grant.json', JSON.stringify(signed));
console.log('resourceId', normalized.resourceId);
console.log('objectSha256', objectSha256);
" | tee -a "${TRANSCRIPT}"

GRANT_B64=$(base64 < "${WORK_DIR}/step1-grant.json" | tr -d '\n')
cat > "${WORK_DIR}/step1-patch.json" <<EOF
{"metadata":{"annotations":{"changesafe.dev/grant":"${GRANT_B64}"}},"spec":{"replicas":4}}
EOF
run kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file="${WORK_DIR}/step1-patch.json"

ACTUAL_REPLICAS=$(kubectl -n changesafe-protected-demo get deploy web -o jsonpath='{.spec.replicas}')
log "web replicas after step 1: ${ACTUAL_REPLICAS} (expected 4)"
if [ "${ACTUAL_REPLICAS}" != "4" ]; then
  log "FAIL: step 1 did not apply — expected replicas=4"
  exit 1
fi

# --- 11. Demo step 2 — DENY: reuse the SAME grant against a different
#         object (replicas: 5 instead of the grant's authorized 4) ---------
log ""
log "=== Demo step 2: DENY (same grant, modified object — object hash mismatch) ==="
cat > "${WORK_DIR}/step2-patch.json" <<EOF
{"metadata":{"annotations":{"changesafe.dev/grant":"${GRANT_B64}"}},"spec":{"replicas":5}}
EOF
set +e
STEP2_OUTPUT=$(kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file="${WORK_DIR}/step2-patch.json" 2>&1)
STEP2_STATUS=$?
set -e
log "\$ kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file=step2-patch.json"
log "${STEP2_OUTPUT}"
if [ "${STEP2_STATUS}" -eq 0 ]; then
  log "FAIL: step 2 was expected to be denied but the patch succeeded"
  exit 1
fi
if ! grep -q "does not match the object the grant authorized" <<<"${STEP2_OUTPUT}"; then
  log "FAIL: step 2 was denied for an unexpected reason"
  exit 1
fi
ACTUAL_REPLICAS=$(kubectl -n changesafe-protected-demo get deploy web -o jsonpath='{.spec.replicas}')
log "web replicas after step 2: ${ACTUAL_REPLICAS} (expected still 4 — the denied patch did not apply)"
if [ "${ACTUAL_REPLICAS}" != "4" ]; then
  log "FAIL: step 2's denied patch appears to have partially applied"
  exit 1
fi

# --- 12. Demo step 3 — fail-closed vs fail-open when the enforcer is down --
log ""
log "=== Demo step 3: fail-closed (protected) vs fail-open (default) when the enforcer is unreachable ==="
run kubectl -n changesafe-system scale deploy/changesafe-enforcer --replicas=0
# Wait for the pod to fully terminate — Kubernetes only calls the webhook
# and hits its failurePolicy once the Service has no ready endpoint left;
# while the old pod is still draining, the request may still reach it.
for _ in $(seq 1 30); do
  REMAINING=$(kubectl -n changesafe-system get pods -l app=changesafe-enforcer --no-headers 2>/dev/null | wc -l | tr -d ' ')
  [ "${REMAINING}" = "0" ] && break
  sleep 2
done

set +e
STEP3_PROTECTED_OUTPUT=$(kubectl -n changesafe-protected-demo patch deployment web --type=merge -p '{"spec":{"replicas":6}}' 2>&1)
STEP3_PROTECTED_STATUS=$?
set -e
log "\$ kubectl -n changesafe-protected-demo patch deployment web --type=merge -p '{\"spec\":{\"replicas\":6}}'"
log "${STEP3_PROTECTED_OUTPUT}"
if [ "${STEP3_PROTECTED_STATUS}" -eq 0 ]; then
  log "FAIL: a protected resource was modified while the enforcer was down (failurePolicy: Fail should have blocked it)"
  exit 1
fi

run kubectl -n changesafe-default-demo patch deployment web --type=merge -p '{"spec":{"replicas":6}}'
DEFAULT_REPLICAS=$(kubectl -n changesafe-default-demo get deploy web -o jsonpath='{.spec.replicas}')
PROTECTED_REPLICAS=$(kubectl -n changesafe-protected-demo get deploy web -o jsonpath='{.spec.replicas}')
log "changesafe-default-demo/web replicas: ${DEFAULT_REPLICAS} (expected 6 — allowed, failurePolicy: Ignore)"
log "changesafe-protected-demo/web replicas: ${PROTECTED_REPLICAS} (expected still 4 — blocked, failurePolicy: Fail)"
if [ "${DEFAULT_REPLICAS}" != "6" ] || [ "${PROTECTED_REPLICAS}" != "4" ]; then
  log "FAIL: step 3's fail-open/fail-closed split did not hold"
  exit 1
fi

kubectl -n changesafe-system scale deploy/changesafe-enforcer --replicas=1 >/dev/null 2>&1 || true

log ""
log "=== All three demo steps passed. Transcript: ${TRANSCRIPT} ==="
