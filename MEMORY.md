# ChangeSafe Project Memory

This is the durable, repository-local handoff for work that must survive a
machine or agent change. It is intentionally concise and human-authored; it
is not a session transcript or a replacement for `AGENTS.md`.

## Product boundary

ChangeSafe is a deterministic airlock for AI-proposed infrastructure changes:

> AI proposes. Deterministic code validates. A human decides. Nothing touches
> real infrastructure.

The repository must never gain an execution path to infrastructure. Ingestion
is read-only, external content is untrusted data, model output is invalid until
local schema validation succeeds, and approval/risk remain deterministic
domain decisions.

## Current project direction

- The project is library/CLI-first; the Next.js app is the showcase console.
- P0–P6 are complete. P7 (benchmark and community contribution surface) is
  ongoing.
- The replay demo and red-team scenario contract are release-critical.
- New work should generally improve scenarios, domains, documentation,
  integrations, tests, or release hardening rather than add platform
  machinery ahead of the roadmap.
- Read `docs/OSS_ROADMAP.md` before starting multi-file work and follow the
  repository contract in `AGENTS.md`.

## Verification baseline

Default validation is offline and does not spend API credit:

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run build:cli
node packages/cli/dist/changesafe.js scenario check
node packages/cli/dist/changesafe.js scenario gallery --check
```

Use `npm run test:e2e` when browser behavior changes. Live model work is
explicitly environment-gated and must not become part of the default test
path.

## Durable context policy

Commit only human-authored project decisions, plans, specifications, and
cross-environment handoffs. The repository allowlist is:

- `MEMORY.md`
- `.omc/README.md` and selected Markdown under `.omc/handoffs/`
- `.omx/README.md` and Markdown under `.omx/context/`, `.omx/plans/`, and
  `.omx/specs/`
- tracked project skills under `.claude/skills/`

OMC/OMX sessions, logs, caches, metrics, state, runtime binaries, tmux data,
Playwright MCP captures, `.next/`, worktrees, and Superpowers runtime output
are local artifacts and remain ignored. Never place credentials, API keys,
private transcripts, absolute machine paths, or personal identifiers in
durable context.

When context becomes obsolete, update or delete the human-authored document;
do not preserve stale runtime snapshots as project truth.
