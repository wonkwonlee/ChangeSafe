#!/usr/bin/env bash
# examples/m2-kubernetes-enforcer/kind-repro.sh
#
# Manual/local reproduction script — not run in CI. Requires kind, kubectl,
# and docker. Exits non-zero on the first unexpected result so a run either
# fully demonstrates the three demo steps or fails loudly.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "This script is a starting skeleton, not a finished reproduction."
echo "Fill in each step below as the kind cluster proves what actually works,"
echo "per the open caveat in README.md (objectSelector cannot match an"
echo "annotation directly)."

# 1. kind create cluster --name changesafe-m2
# 2. build + load the enforcer image
# 3. deploy the enforcer (Deployment + Service + TLS cert, self-signed or
#    via a local CA — record the exact commands here once decided)
# 4. kubectl apply -f webhook-protected.yaml -f webhook-default.yaml
# 5. run the three demo steps from README.md, capturing kubectl output
#    into demo-transcript.txt in this directory

exit 1  # deliberately fails until the steps above are filled in for real
