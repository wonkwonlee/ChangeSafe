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

- The project is library/CLI-first; the Next.js app is the multi-domain Change
  Review Workbench.
- P0–P6 are complete. P7 (benchmark and community contribution surface) is
  ongoing.
- The replay demo and red-team scenario contract are release-critical.
- The vNext default `/` is an ephemeral Network public replay. Terraform and
  Kubernetes use `/workbench/terraform` and `/workbench/kubernetes`.
  Exact `/workbench` and `/api/analyze` are retired.
- Public replay evaluates only. It creates no decision, simulation result,
  durable review, or receipt. The optional self-hosted browser route needs an
  operator-run HTTPS gateway/BFF with an HttpOnly session. `changesafe serve`
  wires the durable review queue store as of #49.
- New work should generally improve scenarios, domains, documentation,
  integrations, tests, or release hardening rather than add platform
  machinery ahead of the roadmap.
- Read `docs/OSS_ROADMAP.md` before starting multi-file work and follow the
  repository contract in `AGENTS.md`.

## Current release and vNext status (2026-07-30)

- Kubernetes shipped in v0.3.0 and was patched in v0.3.1. The v0.3.1 tag and
  GitHub Release are published; use `@changesafe/domain-kubernetes@0.3.1` or
  later.
- The npm `@changesafe/domain-kubernetes@0.3.0` publication is deprecated:
  its direct Node ESM imports were invalid. The bundled `changesafe@0.3.0`
  CLI was unaffected.
- The five public v0.3.1 packages are on npm. The v0.3.0 bootstrap and v0.3.1
  remediation were manually published, so those v0.3.x packages do not have
  npm provenance attestations. Future releases should use the configured npm
  trusted-publishing workflow and verify provenance before announcement.
- v0.3.1 was validated by the full CI gate, including lint, typecheck, unit and
  integration tests, build, Playwright, scenario corpus/gallery, secret scans,
  and Kubernetes offline/read-only checks. A registry smoke also verified the
  CLI version, direct Kubernetes package import, schema parsing, and a clean
  Kubernetes gate.

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
