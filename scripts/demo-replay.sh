#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

npm run build:cli --silent

DEMO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/changesafe-replay.XXXXXX")"
RECEIPT_PATH="$DEMO_DIR/replay-receipt.json"

printf 'Running deterministic replay gate...\n\n'
set +e
node packages/cli/dist/changesafe.js gate \
  --scenario scenarios/scenario-b-route-leak \
  --receipt "$RECEIPT_PATH"
GATE_RC=$?
set -e

if [[ "$GATE_RC" -ne 1 ]]; then
  printf 'Expected replay gate exit code 1 (blocked), got %s.\n' "$GATE_RC" >&2
  exit 1
fi

node packages/cli/dist/changesafe.js verify "$RECEIPT_PATH" --skip-signature
printf '\nReplay receipt: %s\n' "$RECEIPT_PATH"
printf 'Starting replay-only web demo at http://localhost:%s\n' "${PORT:-3100}"
printf 'Open the URL, choose scenario-b-route-leak, then run replay analysis.\n'
printf 'Press Ctrl-C to stop the demo server.\n\n'

exec env -u OPENAI_API_KEY \
  -u ANTHROPIC_API_KEY \
  -u CHANGESAFE_PROVIDER \
  PORT="${PORT:-3100}" \
  npm run dev
