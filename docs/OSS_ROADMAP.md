# ChangeSafe Open-Source Roadmap

Status: adopted 2026-07-25. Supersedes the project's earlier Build Week
framing.
This is the implementation plan. Phases P0–P3 are complete; P4 (Terraform
plan ingestion) is next.

## 1. Vision

ChangeSafe is an open-source **deterministic airlock for AI-proposed
infrastructure changes**: a typed proposal from any AI (or any tool) must
survive pure, deterministic safety policies and an explicit human decision,
and every outcome — approved, rejected, or blocked — becomes a hashed,
verifiable receipt.

The project ships three layers, in priority order:

1. **`@changesafe/core` + CLI** — an embeddable library and a
   CI-friendly command-line gate. This is the adoption engine.
2. **The showcase app** — the existing one-page console (replay-mode demo,
   self-hostable later). This is the storefront.
3. **The scenario/red-team corpus** — community-contributed incidents and
   adversarial proposals; long-term, a public benchmark for AI-agent change
   safety. This is the moat.

One-liner: *"OPA doesn't know about AI, guardrails libraries only look at
text, AI-ops tools have no gate. ChangeSafe is the deterministic,
human-in-the-loop gate at the action level."*

## 2. Decisions locked (2026-07-25)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Strategy | **Library/CLI-first** (owner decision) | OSS adoption comes through embeddable code and CI tools; the app remains the demo surface |
| First real-world ingestion | **Terraform plan JSON** (owner decision) | `terraform show -json` is a ubiquitous, read-only artifact; gating AI-generated infra PRs needs no device access and no collectors |
| Trust model | Unchanged, permanent | AI proposes → deterministic code validates → a human decides → ChangeSafe never executes |
| Model strategy | Provider-agnostic adapters (OpenAI, Anthropic, local/Ollama) | OSS users bring their own model; the deterministic gate makes model choice safety-neutral |
| Persistence (later, self-host) | SQLite-first, Postgres optional | Zero-config self-hosting beats managed-DB-first for OSS |
| License | MIT (already in repo) | |
| Package manager / language | npm workspaces, strict TypeScript, Zod-first | Continuity with the existing codebase |

## 3. Phase plan

Effort scale: S ≈ days, M ≈ 1–2 weeks, L ≈ 3–6 weeks (one engineer + AI
pair). Every phase keeps the replay demo green (`npm test`, `npm run
test:e2e`) — that is a standing exit criterion.

### P0 — Reposition the repository (S) — **done**

Goal: the repo reads as an OSS project, and nothing in the instructions
fights the new direction.

- [x] `docs/OSS_ROADMAP.md` (this document).
- [x] Rewrite `CLAUDE.md` / `AGENTS.md`: drop the Build Week frozen scope
      (two-scenario cap, GPT-5.6/OpenAI-only, single-app layout, submission
      artifacts), keep the trust model and safety invariants, add OSS scope
      rules. The two files stay identical mirrors.
- [x] `BUILD_WEEK_CHANGELOG.md`: closing note — built during the window,
      not submitted, pivoted to OSS; file becomes historical record.
- [x] README rewritten for OSS with an honest history line and a roadmap
      link.
- [x] GitHub Actions CI: lint, typecheck, test, build, e2e, and a
      client-bundle secret check on Node 22/24.
- [x] Repo hygiene: `CONTRIBUTING.md` (scenario contributions first-class),
      `SECURITY.md`, issue/PR templates, `engines` + `.nvmrc`, dead
      fixture-note reference fixed, overclaiming copy softened.
- [x] Public repository: `github.com/wonkwonlee/ChangeSafe`.

Exit gate: a newcomer reading README + CONTRIBUTING + this roadmap
understands what the project is, where it is going, and how to contribute;
CI runs the full gate on every PR.

### P1 — Scenario expectations harness + verdict-space scenarios (S/M) — **done**

Goal: scenarios become data-driven, CI-verified, contributable content —
and the demo shows more than LOW/CRITICAL.

- [x] Per-scenario `expectations.json` (`ScenarioExpectationsSchema`):
      all seven policy statuses, risk level, `approvable`, the simulation
      outcome, and optional per-finding affected-resource assertions. The
      schema itself rejects internally inconsistent claims (declared risk
      or approvability that contradicts the declared statuses).
- [x] `tests/integration/scenario-contracts.test.ts` rewritten as a harness:
      walks `scenarios/` on disk, fails if a directory is unregistered, and
      asserts every scenario's expectations, provenance honesty,
      evidence grounding, documentation-range addresses, and — by
      approvability — either the full approve → simulate → verified receipt
      walk or that approval and simulation are impossible.
      (`scenarios/index.ts` keeps static imports so the registry stays
      usable in the browser bundle; the harness supplies completeness.)
- [x] `docs/SCENARIO_AUTHORING.md` — field-by-field guide, reachability
      rules, expectations format, coverage table, common mistakes.
- [x] New network scenarios filling the verdict space:
  1. `scenario-c-route-flap` — missing postcheck → `VERIFICATION_REQUIRED`
     WARN → **MEDIUM, approvable** (first warned-but-approvable path).
  2. `scenario-d-egress-imbalance` — two devices + missing precondition →
     2×WARN → **HIGH, approvable**.
  3. `scenario-e-rollback-trap` — a rollback that restores the wrong value
     → `ROLLBACK_COMPLETE` BLOCK, everything else PASS.
  4. `scenario-f-over-reach` — one-device incident, three-device proposal →
     `BLAST_RADIUS` BLOCK, everything else PASS.
- [ ] (Stretch, deferred to community) *Injection variant pack* — injection
      in an alert message and in a device description; listed as a coverage
      gap in the authoring guide.

Exit gate: **met** — harness runs all six scenarios from disk; four new
scenarios green; authoring guide published; falsified expectations fail
loudly (verified).

### P2 — Extract `@changesafe/core` (M) — **done**

Goal: the pure engine becomes an embeddable, dependency-light package;
the app becomes its first consumer.

- [x] npm workspaces monorepo:

  ```text
  packages/core/            proposal contract, findings + risk, workflow
                            state machine, universal policies, receipts,
                            the DomainAdapter contract   (dependency: zod)
  packages/domain-network/  incident/topology model, path allowlist,
                            transactional patch engine, reachability,
                            simulator, MGMT_REACHABILITY + PROTECTED_RESOURCE
  app/ components/ lib/ai/  the Next.js console (consumes both packages)
  scenarios/                top-level content, consumed by both
  ```

- [x] Policies split into **universal** (`PATCH_SCHEMA`, `BLAST_RADIUS`,
      `ROLLBACK_COMPLETE`, `VERIFICATION_REQUIRED`, `UNTRUSTED_INSTRUCTION`,
      all written against the adapter) and **domain**
      (`MGMT_REACHABILITY`, `PROTECTED_RESOURCE`). Policy ids became open
      strings so each domain contributes its own; evaluation order is
      published by `policyOrder(adapter)` and stays
      structural → domain → universal, which preserves the previous order
      for the network domain.
- [x] Breaking renames taken in this window: receipt `incidentId` →
      `inputId`, `incidentSha256` → `inputSha256`, `scenarioId` →
      `sourceId`; workflow state `bundle` → `input`, `scenarioId` →
      `sourceId`. `createReceipt` now takes `appVersion`/`policyVersion`
      explicitly instead of importing app constants, and `policyVersion`
      composes core's version with the domain's.
- [x] Public API documented in `packages/core/README.md`, including how to
      implement a `DomainAdapter` and the rules a domain must keep.
- [x] `packages/core/tests/standalone-domain.test.ts` implements a complete
      toy domain (counters) and drives the entire airlock with it — proof
      that core carries no network assumptions.

Deviations from the original plan, taken deliberately:

- The Next.js app stays at the repository root rather than moving to
  `apps/web/`. Moving it is config churn with no effect on the library
  story; it can happen when a second app (docs site) actually exists.
- Tests stay in `tests/` at the root and exercise the packages through
  their public APIs, except core's standalone-domain suite. Per-package
  co-location lands with P3, when each package needs its own build.
- Packages are `private: true` and export TypeScript source consumed via
  workspace resolution. A compiled `dist` build lands in P3, when the CLI
  must run under plain Node without a bundler.

Exit gate: **met** — `npm i` links the workspaces, the app runs on the
extracted packages, core imports nothing from the app or AI layer, and
lint, typecheck, 184 tests, production build, and e2e are green.

### P3 — `changesafe` CLI (M) — **done**

Goal: the gate runs anywhere — terminal and CI — with **no AI dependency**
(gate/verify are fully deterministic).

- [x] `packages/cli` (bin `changesafe`), commands:

  ```text
  changesafe gate     --scenario <dir> | --input <file> --proposal <file>
                      [--domain network] [--policy-pack <file>]
                      [--receipt <out.json>] [--format pretty|json]
  changesafe verify   <receipt.json> [--input <file>] [--proposal <file>]
  changesafe scenario check [dir]
  changesafe scenario init <name>
  ```

- [x] Exit codes `0` (nothing blocking), `1` (blocked), `2` (could not
      evaluate). The 1/2 split is deliberate: a 2 is a *missing* verdict and
      must never read as approval.
- [x] The CLI gates and never approves. Receipts record `gate_only` or
      `blocked`; there is no `--auto-approve` flag. Two new core concepts
      support this honestly: the `gate_only` receipt decision and the
      `offline` analysis mode ("the proposal was handed to us; this run
      produced nothing and attests nothing about its origin").
- [x] Policy packs: typed, Zod-validated thresholds
      (`blastRadius.warnAt/blockAbove`, `verification.require*`) resolved
      over compiled predicates — explicitly not a DSL, and unable to make
      the gate unsound. Defaults reproduce current behavior exactly.
- [x] Ships pre-bundled (esbuild) so it runs under plain Node with no
      bundler and no workspace resolution; a test executes the built binary
      from a temp directory to prove it.
- [x] 21 CLI tests, including the exit-gate proof that CLI findings equal
      the app's for the same scenario, with identical canonical hashes.
- [x] `packages/cli/README.md`.

Exit gate: **met** — `changesafe gate --scenario scenarios/scenario-a-failover`
reproduces the console's findings byte-for-byte, and the CLI has its own
suite.

### P4 — Terraform plan ingestion + GitHub Action (M/L) ★ flagship — **done**

Goal: real-world utility with zero infrastructure access — gate
AI-generated Terraform changes in CI.

- [x] `packages/domain-terraform`, the first **external-diff** domain
      (Shape B from §5): Terraform already computed the diff, so nothing
      simulates. `applyOperations` validates instead of mutating, which
      keeps `PATCH_SCHEMA` meaningful — it now asks whether every operation
      corresponds to a change the plan actually contains, and blocks a
      proposal that misrepresents a delete as an update.
- [x] Plan parsing tolerant at the envelope, strict in the normalized model:
      unknown Terraform fields pass through, `["delete","create"]` reads as
      a replace, no-op and read entries are dropped so they cannot inflate
      blast radius, and each change carries an `ev-plan-N` evidence id — the
      evidence for "this deletes the database" is the plan entry itself.
- [x] Terraform policies: `DESTRUCTIVE_OP` (what class of thing is being
      destroyed — stateful blocks, stateless warns, a declared backup tag
      downgrades to a visible warning rather than silence),
      `PROTECTED_RESOURCE` (address globs and a protected tag), and
      `REVERSIBILITY` (could it be put back — blocks when prior state was
      never recorded, warns when configuration is recoverable but data is
      not).
- [x] Core learned two things this required: domains may declare their own
      default thresholds (a plan touching a dozen cloud resources is
      ordinary; a dozen routers is not), and may skip a universal policy
      **only** with a recorded reason and a named replacement. Terraform
      skips `ROLLBACK_COMPLETE` (no inverse exists to verify; `REVERSIBILITY`
      answers it) and `VERIFICATION_REQUIRED` (plan JSON contains no
      verification plan; the pull request review is that step).
- [x] `--context` carries the pull request body as untrusted text. The
      flagship fixture pairs a protected-bucket replacement with a PR body
      instructing review tooling to approve it: the gate blocks on the
      plan's contents and flags the injection as data.
- [x] `action.yml` (composite Action) + `scripts/format-summary.mjs`: runs
      the CLI, renders a findings table as a pull request comment and job
      summary, uploads the receipt, and fails the check on a block. Exit
      code 2 fails the step regardless of `fail-on-block`, because a missing
      verdict is not an approval.
- [x] `examples/github-actions/gate-terraform-plan.yml` to copy, and a CI
      job that runs the Action's exact gate path against the fixtures.
- [x] Fixture corpus with tests: benign scale-up, database destruction,
      protected replacement with injected PR text, plus pack-tuning and
      unrecorded-prior-state cases.

Exit gate: **met** — the CLI gates real `terraform show -json` output,
blocks the destructive case with explanations, writes a verifiable receipt,
and CI exercises the Action's path end to end.

### Soft launch after P4 (Show HN + blog post: "Your AI SRE agent will
eventually obey a prompt injection — design so it doesn't matter"): this is
the earliest point where the project is useful to a stranger in 10 minutes.

### P5 — Provider-agnostic AI + `changesafe analyze` + eval harness (M) — **done**

- `packages/ai` supplies the adapter interface and three implementations
  (OpenAI Responses / Anthropic Messages / local Ollama), all on plain
  `fetch` — no vendor SDKs, so the bundled CLI gained the feature without
  gaining a third-party dependency, and every adapter is testable with an
  injected transport instead of a mock.
- One Zod schema derives all three wire schemas via `toPortableJsonSchema`,
  reduced to the keyword subset every provider honors. Dropped constraints
  are restated as `description` guidance and re-imposed locally by Zod, so
  the wire schema shapes output while Zod decides acceptance. The
  dual-validation and evidence/device cross-checks run identically for every
  provider — proven by a test asserting all three produce byte-identical
  accepted output from equivalent responses.
- `changesafe analyze --provider …` proposes then gates through the same
  `gateParsedProposal` the `gate` command uses; a failed model call exits 2,
  never 0. `--capture` writes provenance-stamped fixtures for any provider.
- `changesafe eval` reports % schema-valid, % evidence-grounded, and
  red-team block rate per model, separating call failures from model
  failures so a network problem never reads as a model score.
- `FixtureProvenance` generalized `captured_gpt_5_6` → `captured`; the
  fixture's `model` field already records the vendor precisely.
- App copy now names the configured provider and model, and receipts record
  the model that actually answered rather than the one configured.

### P6 — Self-host hardening (L)

SQLite-first: server-side decision
path (authenticated approve/reject; the pure libs relocate verbatim),
SQLite append-only receipt/audit ledger (Postgres optional), OIDC approver
identity, signed receipts (`changesafe verify` learns signatures).

### P7 — Benchmark + community (ongoing)

Curated red-team corpus + model eval reports ("which agents propose unsafe
changes, which gates catch them"); scenario gallery on a docs site
(Starlight/Nextra); good-first-issue pipeline = scenarios; integration
conversations (k8sgpt-style diagnosers emitting ChangeSafe proposals).

## 4. Sequencing rationale

P1 before extraction because the expectations harness is tiny and becomes
the CI backbone for everything after (core tests, CLI tests, terraform
fixtures all reuse it). P2 before P3 because the CLI must be a thin shell
over the library, not a second implementation. P4 is the flagship because
the owner chose Terraform ingestion — it is the shortest path from "demo
over synthetic data" to "gates something real in your CI today" without
ever touching a device. AI work (P5) deliberately comes after the
deterministic surface is adoptable: the gate is the product; the model is
an interchangeable proposer.

## 5. Design notes (constraints for implementation)

**Domain plugin contract (P2).** A domain registers
`{ id, stateSchema?, proposalNormalizer, pathAllowlist?, policies[],
simulator? , renderHints }`. Two shapes:

- **Shape A — simulated-state domain** (network today, K8s later): we hold
  a declarative state model, apply typed operations transactionally to a
  clone, and simulate outcomes. Universal + domain policies run.
- **Shape B — external-diff domain** (terraform): the diff arrives
  precomputed; there is no ChangeSafe-side simulation. The domain declares
  which universal policies apply; the receipt records the active policy
  list and pack. `ROLLBACK_COMPLETE` is replaced by the domain's
  `REVERSIBILITY` analog.

Policies remain pure functions, fail closed, never import AI modules, and
never receive model confidence. Risk derivation
(BLOCK→CRITICAL, 2×WARN→HIGH, 1×WARN→MEDIUM, else LOW) is core-owned and
identical across domains; packs tune policy parameters, never the risk
formula. Any policy behavior change bumps `POLICY_VERSION` (recorded in
receipts).

**CLI trust posture (P3).** The CLI is a *gate*, not an approver: it can
mark blocked/gate-passed and emit receipts, but an "approved" decision
always requires a human action (in the app, or the PR review in CI).
No `--auto-approve` flag will ever exist.

**Naming migration (P2).** Breaking schema renames (e.g.
`incidentSha256` → `inputSha256`) happen once, during extraction, with the
app and fixtures migrated in the same PR. After the first `0.x` publish,
schema changes follow semver + documented migrations.

## 6. Do-not-build (unchanged guardrails)

- Any write/execution path to infrastructure (SSH/NETCONF/gNMI-SET/vendor
  SDK/shell/`terraform apply`). Ingestion is read-only artifacts, forever.
- A customer-authored policy DSL or embedded interpreter (Rego etc.) —
  parameterized compiled predicates only.
- Model influence on approval, risk, or policy outcomes; auto-approval
  fast-paths at any risk level.
- Marketplace/multi-tenant/billing platform work before P6 proves
  self-host demand.
- Generic chat/RAG surfaces.

## 7. Open decisions (owner)

1. npm scope: is `@changesafe` claimable? Fallback names
   (`changesafe-core`, CLI bin name stays `changesafe`).
2. ~~Public repo naming/timing.~~ **Resolved 2026-07-25**: the repository
   is public at `github.com/wonkwonlee/ChangeSafe`.
3. Docs site tooling (Starlight vs Nextra) — decide by P4; README suffices
   until then.
4. Third domain after terraform: Kubernetes (largest audience) vs IAM
   (most visceral lockout demo) — decide after P4 feedback.

## 8. Success metrics (12 weeks post-launch)

- A stranger goes from README to a gated `terraform show -json` plan in
  under 10 minutes (measured by the quickstart).
- ≥5 externally contributed scenarios merged through the expectations
  harness.
- The GitHub Action running in ≥10 public repos.
- Zero safety-invariant regressions: the red-team corpus never approves.
