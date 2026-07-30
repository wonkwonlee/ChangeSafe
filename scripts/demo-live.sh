#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  read -r -s -p 'OpenAI API key (leave empty to use Ollama): ' OPENAI_API_KEY
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

if [[ -z "${CHANGESAFE_PROVIDER:-}" ]]; then
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    CHANGESAFE_PROVIDER="openai"
  else
    CHANGESAFE_PROVIDER="anthropic"
  fi
fi

printf '\nRunning CLI live analysis with provider %s.\n' "$CHANGESAFE_PROVIDER"
printf 'This spends provider credit, gates the proposal deterministically, and never executes infrastructure.\n\n'

exec node packages/cli/dist/changesafe.js analyze \
  --scenario scenarios/scenario-b-route-leak \
  --provider "$CHANGESAFE_PROVIDER"
