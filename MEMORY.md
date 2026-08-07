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

## Current release status (2026-08-07)

- **v0.4.1 is the canonical release.** All five public packages are on npm at
  `0.4.1`, published by the release workflow over trusted publishing, and
  every one carries a verified provenance attestation recording
  `.github/workflows/publish.yml` in `wonkwonlee/ChangeSafe` at
  `refs/tags/v0.4.1`, commit `bafdeeb`. This is the first *complete* set the
  project has published with provenance — the three packages that reached the
  registry during the failed v0.4.0 run were attested too, so v0.4.1 is the
  first release where all five are.
- **Do not point anyone at `0.4.0`.** It published `@changesafe/core`,
  `domain-network`, and `domain-terraform` and then failed: the Kubernetes
  domain had no trusted-publisher configuration on npm, so the registry
  answered 404 and the loop exited before the CLI. Those three are genuine and
  attested; the set is incomplete, not broken, and nothing was withdrawn.
- v0.4.0 could not be re-published because a `release` event runs the workflow
  file **at the tagged commit**, and the resumable-publish fix landed after
  the tag. Moving the tag was rejected: the attestations already record the
  original commit. Hence v0.4.1 rather than a retry.
- Publishing is now resumable — a version already on the registry is skipped
  rather than refused (`scripts/select-unpublished.sh`, covered by
  `tests/integration/release-publish-selection.test.ts`).
- The v0.3.0 `@changesafe/domain-kubernetes` publication is deprecated (its
  direct Node ESM imports were invalid). v0.3.0 and v0.3.1 were published
  manually and carry no attestation.
- v0.4.1 was validated by the full CI gate and, after publication, by a
  registry smoke: `npm audit signatures` clean, the installed CLI gates a
  destructive Terraform plan to exit 1, and the Kubernetes package imports
  directly under Node ESM.

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
Playwright MCP captures, `.next/`, worktrees, Superpowers runtime output, and
the beads work graph under `.beads/` are local artifacts and remain ignored.
Beads holds *scheduling* — what is startable and what is blocked — which is
runtime state; the decisions it schedules belong here or in the roadmap. Never place credentials, API keys,
private transcripts, absolute machine paths, or personal identifiers in
durable context.

When context becomes obsolete, update or delete the human-authored document;
do not preserve stale runtime snapshots as project truth.
