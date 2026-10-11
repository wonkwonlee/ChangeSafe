#!/usr/bin/env bash
# examples/m2-kubernetes-enforcer/kind-repro.sh
#
# Local and CI reproduction script. Requires kind, kubectl,
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
  if [ -n "${WATCH_PID:-}" ]; then kill "${WATCH_PID}" >/dev/null 2>&1 || true; fi
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
# Audit logging is on for M4 experiment 03 (docs/M4_EXPERIMENT_03.md). kind
# generates kubeadm v1beta3 or v1beta4 depending on the node image, and the
# two spell apiServer.extraArgs differently (map vs name/value list); each
# patch names its apiVersion, so only the one matching the generated config
# applies.
cp "${EXAMPLE_DIR}/m4-audit-policy.yaml" "${WORK_DIR}/audit-policy.yaml"
cat > "${WORK_DIR}/kind-config.yaml" <<KINDCONFIG
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraMounts:
      - hostPath: ${WORK_DIR}/audit-policy.yaml
        containerPath: /etc/kubernetes/policies/audit-policy.yaml
        readOnly: true
    kubeadmConfigPatches:
      - |
        apiVersion: kubeadm.k8s.io/v1beta3
        kind: ClusterConfiguration
        apiServer:
          extraArgs:
            audit-log-path: /var/log/kubernetes/kube-apiserver-audit.log
            audit-policy-file: /etc/kubernetes/policies/audit-policy.yaml
          extraVolumes:
            - { name: audit-policies, hostPath: /etc/kubernetes/policies, mountPath: /etc/kubernetes/policies, readOnly: true, pathType: DirectoryOrCreate }
            - { name: audit-logs, hostPath: /var/log/kubernetes, mountPath: /var/log/kubernetes, readOnly: false, pathType: DirectoryOrCreate }
      - |
        apiVersion: kubeadm.k8s.io/v1beta4
        kind: ClusterConfiguration
        apiServer:
          extraArgs:
            - { name: audit-log-path, value: /var/log/kubernetes/kube-apiserver-audit.log }
            - { name: audit-policy-file, value: /etc/kubernetes/policies/audit-policy.yaml }
          extraVolumes:
            - { name: audit-policies, hostPath: /etc/kubernetes/policies, mountPath: /etc/kubernetes/policies, readOnly: true, pathType: DirectoryOrCreate }
            - { name: audit-logs, hostPath: /var/log/kubernetes, mountPath: /var/log/kubernetes, readOnly: false, pathType: DirectoryOrCreate }
KINDCONFIG
run kind create cluster --name "${CLUSTER_NAME}" --config "${WORK_DIR}/kind-config.yaml"
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
# first apply too. Namespace tier selects fail-closed routing; the separate
# changesafe.dev/protected annotation would prohibit every spec change under
# K8S_PROTECTED_RESOURCE, including this demo's otherwise benign scale-up.
log ""
log "--- Creating the demo Deployments (before the webhooks exist, so no grant is needed yet) ---"
cat > "${WORK_DIR}/web-protected.yaml" <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: changesafe-protected-demo
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

# Routing controls are independent of the webhook and fail closed.
run kubectl apply -f "${REPO_ROOT}/examples/m2-kubernetes-enforcer/routing-guards.yaml"
# Wait for asynchronous policy binding propagation by testing the actual denial.
for ATTEMPT in {1..30}; do
  if ! kubectl label namespace changesafe-protected-demo changesafe.dev/tier=default --overwrite --dry-run=server >"${WORK_DIR}/tier-check.txt" 2>&1; then
    if grep -q "cannot be downgraded" "${WORK_DIR}/tier-check.txt"; then break; fi
  fi
  sleep 1
done
grep -q "cannot be downgraded" "${WORK_DIR}/tier-check.txt"
log "protected namespace downgrade: DENY"
if kubectl -n changesafe-protected-demo scale deployment web --replicas=99 >"${WORK_DIR}/scale-check.txt" 2>&1; then
  log "ERROR: protected Scale bypass admitted"; exit 1
fi
grep -q "requires a reviewed parent-resource UPDATE" "${WORK_DIR}/scale-check.txt"
log "protected scale subresource: DENY"

# --- 10. Demo step 1 — ALLOW: issue a grant for a benign replica change,
#        attach it via the changesafe.dev/grant annotation, apply it -------
log ""
log "=== Demo step 1: ALLOW (grant matches the exact object it authorizes) ==="
kubectl -n changesafe-protected-demo get deploy web -o json > "${WORK_DIR}/web-current.json"
# M4 experiment 05 (docs/M4_EXPERIMENT_05.md): one watch, opened before the
# first write and kept through every M4 step, as an observer independent of
# the audit pipeline. Raw API so the stream is newline-delimited events.
# timeoutSeconds bounds it even if this script is killed before cleanup.
WATCH_RV=$(kubectl -n changesafe-protected-demo get deploy web -o jsonpath='{.metadata.resourceVersion}')
kubectl get --raw "/apis/apps/v1/namespaces/changesafe-protected-demo/deployments?watch=1&fieldSelector=metadata.name%3Dweb&allowWatchBookmarks=true&timeoutSeconds=900&resourceVersion=${WATCH_RV}" \
  > "${WORK_DIR}/watch.jsonl" 2>"${WORK_DIR}/watch.err" &
WATCH_PID=$!
log "M4 watch opened at resourceVersion ${WATCH_RV}"
CHANGESAFE_KIND_WORK_DIR="${WORK_DIR}" CHANGESAFE_KIND_ACTOR="${WHOAMI_USER}" \
  npm exec -- vitest run tests/integration/m2-kind-authorize.test.ts | tee -a "${TRANSCRIPT}"

GRANT_B64=$(base64 < "${WORK_DIR}/step1-grant.json" | tr -d '\n')
cat > "${WORK_DIR}/step1-patch.json" <<EOF
{"metadata":{"annotations":{"changesafe.dev/grant":"${GRANT_B64}"}},"spec":{"replicas":4}}
EOF
run kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file="${WORK_DIR}/step1-patch.json" --dry-run=server
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

# --- M4 experiment 03 — what does the API server's own audit record show? -
# Observation only: these steps fail the run solely when the reproduction
# itself breaks (a grant cannot be issued, the setup does not reject),
# never because an M4 hypothesis did not hold. Results are read from the
# summary below and recorded in docs/M4_EXPERIMENT_03.md.
log ""
log "=== M4 experiment 03: downstream rejection after ALLOW, then retry of the burned grant ==="
run kubectl apply -f "${EXAMPLE_DIR}/m4-downstream-reject.yaml"
kubectl -n changesafe-protected-demo get deploy web -o json > "${WORK_DIR}/web-current-m4.json"
CHANGESAFE_KIND_WORK_DIR="${WORK_DIR}" CHANGESAFE_KIND_ACTOR="${WHOAMI_USER}" \
  npm exec -- vitest run tests/integration/m4-kind-downstream-grant.test.ts | tee -a "${TRANSCRIPT}"
M4_GRANT_B64=$(base64 < "${WORK_DIR}/m4-grant.json" | tr -d '\n')
cat > "${WORK_DIR}/m4-patch.json" <<M4PATCH
{"metadata":{"labels":{"m4.changesafe.dev/downstream":"reject"},"annotations":{"changesafe.dev/grant":"${M4_GRANT_B64}"}},"spec":{"replicas":5}}
M4PATCH
set +e
M4_REJECTED_OUTPUT=$(kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file="${WORK_DIR}/m4-patch.json" 2>&1)
M4_REJECTED_STATUS=$?
set -e
log "\$ kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file=m4-patch.json   # downstream webhook registered"
log "${M4_REJECTED_OUTPUT}"
if [ "${M4_REJECTED_STATUS}" -eq 0 ]; then
  log "FAIL: the downstream-rejecting webhook did not reject the write; the experiment's setup is invalid"
  exit 1
fi
# A nonzero status is not enough: an enforcer DENY or a use-state failure
# would also exit nonzero and never exercise ALLOW-then-downstream-reject.
# The rejection must name the downstream webhook, and the enforcer's own
# use-state must hold this grant as consumed (it answered ALLOW).
if ! grep -q 'downstream-reject.m4.changesafe.dev' <<<"${M4_REJECTED_OUTPUT}"; then
  log "FAIL: the write was refused, but not by the downstream webhook; the experiment's setup is invalid"
  exit 1
fi
M4_GRANT_ID=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).grant.grantId' "${WORK_DIR}/m4-grant.json")
M4_CONSUMER=$(kubectl -n changesafe-system exec deploy/changesafe-enforcer -- node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.env.GRANT_USES_DB, { readOnly: true });
  const row = db.prepare("SELECT admission_uid FROM consumed_grants WHERE grant_id = ?").get(process.argv[1]);
  process.stdout.write(row === undefined ? "" : String(row.admission_uid ?? "null"));
' "${M4_GRANT_ID}" 2>/dev/null || true)
if [ -z "${M4_CONSUMER}" ]; then
  log "FAIL: the enforcer's use-state holds no consumption for this grant; it did not answer ALLOW, so the setup is invalid"
  exit 1
fi
log "enforcer consumed the grant for admission ${M4_CONSUMER}; the downstream webhook then rejected the write"
log "web replicas after downstream rejection: $(kubectl -n changesafe-protected-demo get deploy web -o jsonpath='{.spec.replicas}') (4 means not persisted)"

run kubectl delete validatingwebhookconfiguration changesafe-m4-downstream-reject
set +e
M4_RETRY_OUTPUT=$(kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file="${WORK_DIR}/m4-patch.json" 2>&1)
M4_RETRY_STATUS=$?
set -e
log "\$ kubectl -n changesafe-protected-demo patch deployment web --type=merge --patch-file=m4-patch.json   # downstream webhook removed, same grant"
log "${M4_RETRY_OUTPUT}"
M4_RETRY_REPLICAS=$(kubectl -n changesafe-protected-demo get deploy web -o jsonpath='{.spec.replicas}')
log "M4 retry exit status: ${M4_RETRY_STATUS}; web replicas: ${M4_RETRY_REPLICAS}"
# The retry is an observation, so its outcome may legitimately change the
# Deployment (5 replicas if H3d did not hold). Step 3 measures the
# fail-closed split relative to what the observation left, not to a
# constant, so a negative M4 result never reads as a failed reproduction.
STEP3_BASELINE_REPLICAS="${M4_RETRY_REPLICAS}"

sleep 2
docker exec "${CLUSTER_NAME}-control-plane" cat /var/log/kubernetes/kube-apiserver-audit.log > "${WORK_DIR}/audit.log"
kubectl -n changesafe-system exec deploy/changesafe-enforcer -- node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.env.GRANT_USES_DB, { readOnly: true });
  process.stdout.write(JSON.stringify(db.prepare("SELECT grant_id, admission_uid FROM consumed_grants ORDER BY rowid").all()));
' > "${WORK_DIR}/use-state.json" 2>/dev/null
log ""
log "--- M4 experiment 03 evidence ---"
node "${EXAMPLE_DIR}/m4-audit-summary.mjs" "${WORK_DIR}/audit.log" "${WORK_DIR}/use-state.json" \
  "${EXAMPLE_DIR}/m4-audit-evidence.jsonl" | tee -a "${TRANSCRIPT}"

# --- M4 experiment 05 — what did the independent watch see? ---------------
# The watch is closed first so its output file is complete and the summary
# reads a fixed stream. Observation only, like the 03 summary above.
# Record how the stream ended before touching it: a watch that died early
# (timeout, 410, a dropped connection) must not look like a quiet object.
# The object's current version marks where a complete stream must end: its
# last event carries the version of the object's last modification.
WATCH_END_RV=$(kubectl -n changesafe-protected-demo get deploy web -o jsonpath='{.metadata.resourceVersion}')
# Wait for a *Deployment* event at the object's version; text elsewhere in
# the stream (a bookmark, an error) must not satisfy this.
for _ in $(seq 1 20); do
  if [ "$(node "${EXAMPLE_DIR}/m4-last-deployment-version.mjs" "${WORK_DIR}/watch.jsonl")" = "${WATCH_END_RV}" ]; then break; fi
  sleep 0.5
done
# Liveness is sampled after the settle loop, so a watch that died while we
# waited (a 410, a dropped connection, its own timeout) is not recorded alive.
WATCH_ALIVE=1
kill -0 "${WATCH_PID}" 2>/dev/null || WATCH_ALIVE=0
kill "${WATCH_PID}" >/dev/null 2>&1 || true
wait "${WATCH_PID}" 2>/dev/null || true
WATCH_PID=""
if [ "${WATCH_ALIVE}" = "0" ] || [ -s "${WORK_DIR}/watch.err" ]; then
  log "WATCH INCOMPLETE: alive at close=${WATCH_ALIVE}; stderr: $(head -c 300 "${WORK_DIR}/watch.err" 2>/dev/null | tr '\n' ' ')"
fi
log ""
log "--- M4 experiment 05 evidence (watch from resourceVersion ${WATCH_RV}) ---"
node "${EXAMPLE_DIR}/m4-watch-summary.mjs" "${WORK_DIR}/watch.jsonl" "${WORK_DIR}/audit.log" \
  "${WORK_DIR}/use-state.json" "${WORK_DIR}/step1-grant.json" "${WORK_DIR}/m4-grant.json" \
  "${REPO_ROOT}/packages/kubernetes-enforcer/dist/index.js" \
  "${EXAMPLE_DIR}/m4-watch-evidence.json" "${WATCH_RV}" "${WATCH_END_RV}" "${WATCH_ALIVE}" "${WORK_DIR}/watch.err" \
  | tee -a "${TRANSCRIPT}"

# --- M4 experiment 06 — what can an observer recover after the fact? ------
# Four short, bounded requests against the same API server, from the
# version read just before step 1 (what a recorded oldObject version would
# be), a version far too old, version 0, and a NotOlderThan list. Each
# captures stdout and stderr: whether "too old" arrives as a 410 response
# or as an ERROR event is part of what is being observed.
M4_REPLAY_BASE="/apis/apps/v1/namespaces/changesafe-protected-demo/deployments?fieldSelector=metadata.name%3Dweb"
m4_object_rv() { kubectl -n changesafe-protected-demo get deploy web -o jsonpath='{.metadata.resourceVersion}' 2>/dev/null || true; }
m4_replay() {
  # The object's version just before and just after each request is its
  # completeness marker: when the two are equal nothing moved while the
  # request ran, and a replay's last event should carry that version.
  m4_object_rv > "${WORK_DIR}/replay-$1.before"
  kubectl get --raw "${M4_REPLAY_BASE}&watch=1&timeoutSeconds=4&resourceVersion=$2" \
    >"${WORK_DIR}/replay-$1.jsonl" 2>&1 || true
  m4_object_rv > "${WORK_DIR}/replay-$1.after"
}
m4_replay replay "${WATCH_RV}"
# Experiment 05 showed the read before step 1 is not what the real admission
# saw (status-only updates landed in between). The dry-run's response
# carries the version it read, which stands in here for a recorded
# oldObject version (proposal P3); replay from it as well.
M4_STEP1_GRANT_ID=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).grant.grantId' "${WORK_DIR}/step1-grant.json")
M4_PRIOR_RV=$(node "${EXAMPLE_DIR}/m4-prior-version.mjs" "${WORK_DIR}/audit.log" "${M4_STEP1_GRANT_ID}" || true)
# Replaying from the admission's version is the experiment's central case: a
# lookup that finds none (the dry-run's response missing, or its shape
# changed) is an invalid setup, not an experiment with a gap.
if [ -z "${M4_PRIOR_RV}" ]; then
  log "FAIL: no prior resourceVersion could be recovered for grant ${M4_STEP1_GRANT_ID} from the audit log; the replay-from-admission case cannot be exercised"
  exit 1
fi
m4_replay replay-prior "${M4_PRIOR_RV}"
m4_replay ancient 1
m4_replay any 0
kubectl get --raw "${M4_REPLAY_BASE}&resourceVersion=${WATCH_RV}&resourceVersionMatch=NotOlderThan" \
  >"${WORK_DIR}/replay-list.jsonl" 2>&1 || true
log ""
log "--- M4 experiment 06 evidence (replay from resourceVersion ${WATCH_RV}) ---"
node "${EXAMPLE_DIR}/m4-replay-summary.mjs" "${WORK_DIR}" "${WORK_DIR}/step1-grant.json" "${WORK_DIR}/m4-grant.json" \
  "${REPO_ROOT}/packages/kubernetes-enforcer/dist/index.js" "${WATCH_RV}" \
  "${EXAMPLE_DIR}/m4-replay-evidence.json" "${M4_PRIOR_RV}" | tee -a "${TRANSCRIPT}"

# --- M4 experiment 09 — can a write outside the enforcer set the carrier? ---
# Attempts, against the demo Deployment in the protected namespace, to set the
# grant carrier by paths that are not an admitted UPDATE of the main
# resource, then reads the object and the audit log back. Observation only:
# whatever the API server does is the result (docs/M4_EXPERIMENT_09.md).
log ""
log "=== M4 experiment 09: setting the grant carrier outside the enforcer ==="
M4_NS="changesafe-protected-demo"
m4_probe() {
  local name="$1"; shift
  set +e
  "$@" > "${WORK_DIR}/probe-${name}.out" 2>&1
  echo $? > "${WORK_DIR}/probe-${name}.status"
  set -e
  kubectl -n "${M4_NS}" get deploy web -o json > "${WORK_DIR}/probe-${name}.after.json" 2>/dev/null || true
  log "\$ probe ${name}: exit $(cat "${WORK_DIR}/probe-${name}.status"); $(head -c 200 "${WORK_DIR}/probe-${name}.out" | tr '\n' ' ')"
}
kubectl -n "${M4_NS}" get deploy web -o json > "${WORK_DIR}/probe-before.json"
M4_PRE_PROBE_REPLICAS=$(kubectl -n "${M4_NS}" get deploy web -o jsonpath='{.spec.replicas}')
date -u +%Y-%m-%dT%H:%M:%S.%6NZ > "${WORK_DIR}/probe-window.txt"
m4_probe annotate-main kubectl -n "${M4_NS}" annotate deployment web changesafe.dev/grant=m4-forged-main --overwrite
m4_probe patch-status-annotation kubectl -n "${M4_NS}" patch deployment web --subresource=status --type=merge \
  -p '{"metadata":{"annotations":{"changesafe.dev/grant":"m4-forged-status"}}}'
m4_probe patch-status-spec kubectl -n "${M4_NS}" patch deployment web --subresource=status --type=merge \
  -p '{"spec":{"replicas":9},"metadata":{"labels":{"m4.changesafe.dev/probe":"status"}}}'
date -u +%Y-%m-%dT%H:%M:%S.%6NZ >> "${WORK_DIR}/probe-window.txt"
sleep 2
docker exec "${CLUSTER_NAME}-control-plane" cat /var/log/kubernetes/kube-apiserver-audit.log > "${WORK_DIR}/audit-after-probe.log"
log "--- M4 experiment 09 evidence ---"
node "${EXAMPLE_DIR}/m4-carrier-probe-summary.mjs" "${WORK_DIR}" "${WORK_DIR}/audit-after-probe.log" \
  "${EXAMPLE_DIR}/m4-carrier-probe-evidence.json" | tee -a "${TRANSCRIPT}"
# --- M4 experiment 10 — does a status-subresource guard close that path? ---
# Applies the CANDIDATE guard (m4-status-guard-candidate.yaml, not adopted),
# repeats the carrier probe, makes a harmless status write, and produces a
# real controller status change by deleting a pod (docs/M4_EXPERIMENT_10.md).
log ""
log "=== M4 experiment 10: a candidate guard on the status subresource ==="
kubectl -n "${M4_NS}" get deploy web -o json > "${WORK_DIR}/guard-before.json"
run kubectl apply -f "${EXAMPLE_DIR}/m4-status-guard-candidate.yaml"
# Admission policies take effect asynchronously: wait until a server dry-run
# of the forging patch is denied, as the routing guards are waited on above.
GUARD_ACTIVE="no"
for _ in $(seq 1 30); do
  kubectl -n "${M4_NS}" patch deployment web --subresource=status --type=merge --dry-run=server \
    -p '{"metadata":{"annotations":{"changesafe.dev/grant":"m4-guard-wait"}}}' >"${WORK_DIR}/guard-wait.txt" 2>&1 || true
  # Any failure is not enough (a conflict or a timeout also fails): the
  # refusal must name this policy.
  if grep -q "changesafe-protected-status-annotations" "${WORK_DIR}/guard-wait.txt"; then
    GUARD_ACTIVE="yes"; break
  fi
  sleep 1
done
echo "active=${GUARD_ACTIVE}" > "${WORK_DIR}/guard-applied.txt"
if [ "${GUARD_ACTIVE}" != "yes" ]; then
  log "FAIL: the candidate guard never refused a dry-run naming its policy; the experiment's setup is invalid"
  cat "${WORK_DIR}/guard-wait.txt" | tee -a "${TRANSCRIPT}"
  exit 1
fi
m4_guard_probe() {
  local name="$1"; shift
  set +e
  "$@" > "${WORK_DIR}/guard-${name}.out" 2>&1
  echo $? > "${WORK_DIR}/guard-${name}.status"
  set -e
  kubectl -n "${M4_NS}" get deploy web -o json > "${WORK_DIR}/guard-${name}.after.json" 2>/dev/null || true
  log "\$ guard probe ${name}: exit $(cat "${WORK_DIR}/guard-${name}.status"); $(head -c 240 "${WORK_DIR}/guard-${name}.out" | tr '\n' ' ')"
}
m4_guard_probe status-annotation kubectl -n "${M4_NS}" patch deployment web --subresource=status --type=merge -v=6 \
  -p '{"metadata":{"annotations":{"changesafe.dev/grant":"m4-forged-status-2"}}}'
m4_guard_probe status-harmless kubectl -n "${M4_NS}" patch deployment web --subresource=status --type=json \
  -p '[{"op":"add","path":"/status/conditions/-","value":{"type":"M4Probe","status":"True","reason":"Probe","message":"experiment 10 harmless status write"}}]'
# H10c is a live gate: a harmless status write the candidate guard refuses (a
# policy edit or a Kubernetes-version difference) must fail this run, not only
# the replay test over the committed artifact. The write must have succeeded
# and its condition must be on the object.
if [ "$(cat "${WORK_DIR}/guard-status-harmless.status")" != "0" ] ||
   ! grep -q '"M4Probe"' "${WORK_DIR}/guard-status-harmless.after.json"; then
  log "FAIL: the harmless status write was refused or did not land; H10c would pass vacuously: $(head -c 300 "${WORK_DIR}/guard-status-harmless.out" | tr '\n' ' ')"
  exit 1
fi
# A real controller status write: delete one pod and let the ReplicaSet and
# the Deployment controller reconcile. The replay watch lists what the
# Deployment's status did.
# One read gives both the "before" object and the replay's start version.
kubectl -n "${M4_NS}" get deploy web -o json > "${WORK_DIR}/controller-before.json"
M4_CTRL_RV=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).metadata.resourceVersion' "${WORK_DIR}/controller-before.json")
M4_POD=$(kubectl -n "${M4_NS}" get pod -l app=web -o name | head -1)
if [ -z "${M4_POD}" ]; then
  log "FAIL: no pod matched app=web in ${M4_NS}; no controller status write can be provoked, so the setup is invalid"
  exit 1
fi
echo "${M4_POD}" > "${WORK_DIR}/controller-pod.txt"
kubectl -n "${M4_NS}" delete "${M4_POD}" --wait=false >"${WORK_DIR}/controller-delete.txt" 2>&1 || {
  log "FAIL: deleting ${M4_POD} did not succeed: $(cat "${WORK_DIR}/controller-delete.txt")"; exit 1; }
# Wait for the controller to REACT first (the Deployment's version moves),
# then for the reconcile to finish (ready replicas back at the desired
# count). Waiting only for the second can pass before the first happens.
M4_REACTED="no"
for _ in $(seq 1 40); do
  NOW_RV=$(kubectl -n "${M4_NS}" get deploy web -o jsonpath='{.metadata.resourceVersion}' 2>/dev/null || true)
  if [ -n "${NOW_RV}" ] && [ "${NOW_RV}" != "${M4_CTRL_RV}" ]; then M4_REACTED="yes"; break; fi
  sleep 1
done
M4_RECOVERED="no"
for _ in $(seq 1 40); do
  READY=$(kubectl -n "${M4_NS}" get deploy web -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)
  DESIRED=$(kubectl -n "${M4_NS}" get deploy web -o jsonpath='{.spec.replicas}' 2>/dev/null || true)
  if [ -n "${READY}" ] && [ "${READY}" = "${DESIRED}" ]; then M4_RECOVERED="yes"; break; fi
  sleep 3
done
echo "reacted=${M4_REACTED}" > "${WORK_DIR}/controller-reacted.txt"
echo "recovered=${M4_RECOVERED}" > "${WORK_DIR}/controller-recovered.txt"
if [ "${M4_REACTED}" != "yes" ]; then
  log "FAIL: the Deployment's version never moved after ${M4_POD} was deleted; the controller's status write was not observed"
  exit 1
fi
if [ "${M4_RECOVERED}" != "yes" ]; then
  log "FAIL: ready replicas never returned to the desired count after ${M4_POD} was deleted; the controller's recovery was not observed (a status write may be blocked)"
  exit 1
fi
kubectl -n "${M4_NS}" get deploy web -o json > "${WORK_DIR}/controller-after.json"
kubectl get --raw "/apis/apps/v1/namespaces/${M4_NS}/deployments?fieldSelector=metadata.name%3Dweb&watch=1&timeoutSeconds=4&resourceVersion=${M4_CTRL_RV}" \
  > "${WORK_DIR}/controller-replay.jsonl" 2>/dev/null || true
log "--- M4 experiment 10 evidence ---"
node "${EXAMPLE_DIR}/m4-status-guard-summary.mjs" "${WORK_DIR}" "${EXAMPLE_DIR}/m4-status-guard-evidence.json" | tee -a "${TRANSCRIPT}"
# The candidate is removed so step 3 runs as it always has, and the removal
# is waited for: policy changes are asynchronous in both directions. A
# dry-run of the forging patch that now succeeds shows it is gone.
kubectl delete -f "${EXAMPLE_DIR}/m4-status-guard-candidate.yaml" --ignore-not-found >/dev/null 2>&1 || true
GUARD_REMOVED="no"
for _ in $(seq 1 30); do
  # Removal is shown only by the dry-run patch itself succeeding: an error
  # that merely omits the policy name (a timeout, an auth failure) is not it.
  if kubectl -n "${M4_NS}" patch deployment web --subresource=status --type=merge --dry-run=server \
    -p '{"metadata":{"annotations":{"changesafe.dev/grant":"m4-guard-gone"}}}' >"${WORK_DIR}/guard-gone.txt" 2>&1; then
    GUARD_REMOVED="yes"; break
  fi
  sleep 1
done
log "candidate guard removed: ${GUARD_REMOVED}"
if [ "${GUARD_REMOVED}" != "yes" ]; then
  log "FAIL: the candidate guard still refuses after its removal; step 3 would run under it"
  exit 1
fi

# Step 3 keeps the replica count from BEFORE the probes as its baseline. If a
# status write had changed spec.replicas (experiment 09's H9c failing), that is
# not an observation to absorb: it would mean the status subresource can change
# spec, and step 3's fail-closed check then fails the run, loudly, on purpose.
# The probe also leaves a forged carrier on the Deployment; step 3 does not
# read the carrier.
M4_POST_PROBE_REPLICAS=$(kubectl -n "${M4_NS}" get deploy web -o jsonpath='{.spec.replicas}')
if [ "${M4_POST_PROBE_REPLICAS}" != "${M4_PRE_PROBE_REPLICAS}" ]; then
  log "M4-09 FINDING: the probes changed spec.replicas from ${M4_PRE_PROBE_REPLICAS} to ${M4_POST_PROBE_REPLICAS}; the status subresource can change spec"
fi
STEP3_BASELINE_REPLICAS="${M4_PRE_PROBE_REPLICAS}"

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
log "changesafe-protected-demo/web replicas: ${PROTECTED_REPLICAS} (expected still ${STEP3_BASELINE_REPLICAS} — blocked, failurePolicy: Fail)"
if [ "${DEFAULT_REPLICAS}" != "6" ] || [ "${PROTECTED_REPLICAS}" != "${STEP3_BASELINE_REPLICAS}" ]; then
  log "FAIL: step 3's fail-open/fail-closed split did not hold"
  exit 1
fi

kubectl -n changesafe-system scale deploy/changesafe-enforcer --replicas=1 >/dev/null 2>&1 || true

log ""
log "=== All three demo steps passed. Transcript: ${TRANSCRIPT} ==="
