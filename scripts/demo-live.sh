#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  read -r -s -p 'OpenAI API key (leave empty to use an existing provider): ' OPENAI_API_KEY
  printf '\n'
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    export OPENAI_API_KEY
    export CHANGESAFE_PROVIDER="${CHANGESAFE_PROVIDER:-openai}"
  fi
fi

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && "${CHANGESAFE_PROVIDER:-}" != "ollama" ]]; then
  printf 'No hosted provider key found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or CHANGESAFE_PROVIDER=ollama.\n' >&2
  exit 2
fi

npm run build:cli --silent

PORT="${PORT:-3100}"
printf '\nChangeSafe live demo is starting at http://localhost:%s\n' "$PORT"
printf 'Open the URL, choose scenario-b-route-leak, then run live analysis.\n'
printf 'Press Ctrl-C to stop the demo server.\n\n'

exec env PORT="$PORT" npm run dev
