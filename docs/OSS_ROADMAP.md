# ChangeSafe Open-Source Roadmap

Status: adopted 2026-07-25. Supersedes the YC/Build Week framing of
`docs/V2_PLAN.md` (kept for reference; its technical findings remain valid).
This is the implementation plan — no code in the phases below has been
written yet unless a phase is explicitly marked done.

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

### P0 — Reposition the repository (S) ← current phase

Goal: the repo reads as an OSS project, and nothing in the instructions
fights the new direction.

- [x] `docs/OSS_ROADMAP.md` (this document).
- [x] Rewrite `CLAUDE.md` / `AGENTS.md`: drop the Build Week frozen scope
      (two-scenario cap, GPT-5.6/OpenAI-only, single-app layout, submission
      artifacts), keep the trust model and safety invariants, add OSS scope
      rules. The two files stay identical mirrors.
- [x] `BUILD_WEEK_CHANGELOG.md`: closing note — built during the window,
      not submitted, pivoted to OSS; file becomes historical record.
- [ ] README hero rewrite for OSS (drop "Built for OpenAI Build Week" as the
      identity; keep an honest history line), add roadmap link.
- [ ] GitHub Actions CI: lint + typecheck + test + build + e2e on PRs,
      Node LTS matrix; badge in README.
- [ ] Repo hygiene: `CONTRIBUTING.md` (scenario contributions first-class),
      `SECURITY.md`, issue/PR templates, `engines` + `.nvmrc`,
      fix the dead `scripts/capture-fixture.ts` reference in scenario A's
      fixture note, soften "enterprise operations console" copy.
- [ ] Decide public repo naming/timing (see §7 Open decisions).

Exit gate: a newcomer reading README + CONTRIBUTING + this roadmap
understands what the project is, where it is going, and how to contribute;
CI runs the full gate on every PR.

### P1 — Scenario expectations harness + verdict-space scenarios (S/M)

Goal: scenarios become data-driven, CI-verified, contributable content —
and the demo shows more than LOW/CRITICAL.

- Per-scenario `expectations.json` (schema-validated): expected policy
  statuses, expected risk level, `approvable`, `simulatable`, plus optional
  per-finding assertions (e.g. affected resources).
- Generalize `tests/integration/scenario-contracts.test.ts` into a harness
  that discovers every directory under `scenarios/` and asserts its
  expectations — a contributed scenario is a PR whose CI proves its claims.
- `docs/SCENARIO_AUTHORING.md`: bundle rules (fictional data, documentation
  IP ranges, provenance honesty), expectations format, checklist.
- New network scenarios filling the verdict space (each with expectations):
  1. *Missing postcheck* → `VERIFICATION_REQUIRED` WARN → **MEDIUM, approvable** —
     first scenario exercising human judgment on a warned change.
  2. *Two-device change + incomplete verification* → 2×WARN → **HIGH, approvable**.
  3. *Rollback trap* — forward ops apply, rollback restores a wrong value →
     `ROLLBACK_COMPLETE` BLOCK (shows canonical-equality verification).
  4. *Over-reach agent* — one-device incident, three-device "while we're at
     it" proposal → `BLAST_RADIUS` BLOCK.
  5. (Stretch) *Injection variant pack* — injection in an alert message and
     in a device description, not just operator notes.

Exit gate: harness runs all scenarios from disk; ≥4 new scenarios green;
authoring guide published.

### P2 — Extract `@changesafe/core` (M)

Goal: the pure engine becomes an embeddable, dependency-light package;
the app becomes its first consumer.

- npm workspaces monorepo:

  ```text
  packages/core/            schemas, state machine, policies, patch,
                            receipt, validate  (dependency: zod only)
  packages/domain-network/  network state model, path allowlist,
                            reachability, network policies, simulator
  apps/web/                 the existing Next.js console (imports core)
  scenarios/                stays top-level content, consumed by both
  ```

- While extracting (the only window for breaking renames — nothing external
  depends on us yet): generalize `incident*` naming where it is
  domain-neutral (e.g. receipt `incidentSha256` → `inputSha256` with a
  documented mapping), and split policies into **universal**
  (`PATCH_SCHEMA`-analog input validity, `BLAST_RADIUS`,
  `ROLLBACK_COMPLETE`, `VERIFICATION_REQUIRED`, `UNTRUSTED_INSTRUCTION`)
  vs **domain** (`MGMT_REACHABILITY`, `PROTECTED_RESOURCE` semantics) —
  see §5 plugin contract.
- Public API surface documented (`packages/core/README.md`); semver from
  `0.x`; changesets (or equivalent) for releases.
- All 130+ tests move with their modules; app behavior unchanged
  (e2e green proves it).

Exit gate: `npm i` at root builds all workspaces; app runs on the extracted
core; core has zero app/AI imports; tests + e2e green.

### P3 — `changesafe` CLI (M)

Goal: the gate runs anywhere — terminal and CI — with **no AI dependency**
(gate/verify are fully deterministic).

- `packages/cli` (published as `changesafe`), commands:

  ```text
  changesafe gate    --domain <network|terraform> --input <file>
                     [--proposal <file>] [--policy-pack <file>]
                     [--context <untrusted-text-file>]
                     [--format pretty|json] [--receipt <out.json>]
  changesafe verify  <receipt.json>          # recompute + check hashes
  changesafe scenario check [dir]            # run expectations harness
  changesafe scenario init <name>            # scaffold a scenario
  ```

- Exit codes: `0` no BLOCK (approvable), `1` BLOCK, `2` usage/validation
  error — CI-composable by design.
- The CLI issues receipts with `decision: "blocked"` or a new
  `gate-only` mode note; **the CLI never auto-approves** — in CI the human
  decision is the PR review itself, and the receipt records the gate
  verdict, not an approval.
- Policy-pack config (typed, Zod-validated parameters over compiled
  predicates — thresholds, protected patterns; explicitly **not** a DSL).

Exit gate: `npx changesafe gate --domain network --input <scenario bundle>
--proposal <fixture>` reproduces the app's findings byte-for-byte
(same canonical hashes); CLI has its own test suite.

### P4 — Terraform plan ingestion + GitHub Action (M/L) ★ flagship

Goal: real-world utility with zero infrastructure access — gate
AI-generated Terraform changes in CI.

- `packages/domain-terraform`:
  - Input: `terraform show -json <plan>` output. Zod schema for the subset
    we police (`resource_changes[].address/type/change.actions/
    change.before/after`, module paths), tolerant of unknown extra fields
    at the plan envelope, strict in our normalized model.
  - Normalize to an **external-diff proposal**: `{action:
    create|update|delete|replace, address, resourceType, before, after}` —
    Terraform already computed the diff, so this domain does not simulate;
    the plan *is* the simulation (see §5, domain shape B).
  - Terraform policy pack (defaults, all pack-tunable):
    - `DESTRUCTIVE_OP` — delete/replace of stateful resource classes
      (databases, volumes, buckets…) BLOCK by default; stateless WARN.
    - `PROTECTED_RESOURCE` — address/tag patterns from the pack
      (e.g. `aws_db_instance.*`, `tags.changesafe=protected`).
    - `BLAST_RADIUS` — changed-resource / touched-module counts.
    - `REVERSIBILITY` (rollback analog) — deletes/replaces without
      `prevent_destroy` or declared backup evidence.
    - `UNTRUSTED_INSTRUCTION` — deterministic scan of `--context`
      (PR body / incident text accompanying an AI-generated change).
  - Receipts identical in structure; `inputSha256` = canonical plan subset.
- `changesafe-action` (GitHub Action): wraps the CLI; posts a findings
  table + risk as a PR comment; fails the check on BLOCK; uploads the
  receipt as an artifact.
- Example repo/workflow: "AI opens a Terraform PR → ChangeSafe gates it."

Exit gate: a real `terraform show -json` fixture corpus (hand-authored +
captured from public examples) with expectations; the Action demo works on
a sample PR end to end.

**Soft launch after P4** (Show HN + blog post: "Your AI SRE agent will
eventually obey a prompt injection — design so it doesn't matter"): this is
the earliest point where the project is useful to a stranger in 10 minutes.

### P5 — Provider-agnostic AI + `changesafe analyze` + eval harness (M)

- `packages/ai` adapter interface (OpenAI / Anthropic / Ollama-local);
  structured output where supported, JSON-schema prompting + strict Zod
  elsewhere; the existing dual-validation and evidence/device cross-checks
  apply to every provider identically.
- `changesafe analyze --provider …` produces a proposal from an incident
  bundle, then gates it (full airlock in one command).
- Capture pipeline → provenance-stamped fixtures for any provider; eval
  harness: % schema-valid, % evidence-grounded, % red-team-set blocked,
  per model — publishable results, feeds the P7 benchmark.
- App copy generalizes from "GPT-5.6" to configured-provider naming.

### P6 — Self-host hardening (L)

Adapted from `docs/V2_PLAN.md` §5 with SQLite-first: server-side decision
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
2. Public repo naming/timing: keep `ChangeSafe-v1` private during P0–P1,
   or rename/create `changesafe` and go public at P1 (recommended: go
   public early — the history is clean and honest).
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
