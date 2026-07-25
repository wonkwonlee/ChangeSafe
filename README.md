# ChangeSafe

[![CI](https://github.com/wonkwonlee/ChangeSafe/actions/workflows/ci.yml/badge.svg)](https://github.com/wonkwonlee/ChangeSafe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**TL;DR**
- AI agents can now propose real infrastructure changes — and will confidently propose a dangerous one.
- ChangeSafe treats every AI proposal as untrusted data: a pure, deterministic policy engine decides what's safe, not the model's confidence score.
- Every approval, rejection, or block becomes a hashed, replayable receipt — so "the AI said it was fine" is never the answer to "why did this happen."

**A deterministic airlock for AI-proposed infrastructure changes.**

An AI proposes a change. ChangeSafe treats that proposal as untrusted
data: pure, deterministic policies validate it, a human makes the decision,
and every outcome — approved, rejected, or blocked — becomes a hashed,
verifiable receipt.

> AI diagnoses and proposes. Deterministic code validates. A human decides.
> ChangeSafe never executes changes against infrastructure.

## Why

AI agents are being handed real actions on production systems. During an
incident they will confidently propose a change that severs management
access, deletes a protected resource, or ships without a rollback — and a
reviewer under pressure approves the prose, not an executable policy. Worse,
the "incident context" an agent reads is attacker-influenceable: an alert or
an operator note can carry an injected instruction.

ChangeSafe is the missing layer. The model's output is just typed data that
must survive deterministic policies and an explicit human decision. **The
model's 91%-confident proposal buys it nothing** — confidence is displayed,
never used. Safety never depends on the model resisting injection.

![The red-team scenario blocked by the deterministic safety gate](docs/screenshots/scenario-b-blocked.png)

*A red-team scenario: a confident proposal (echoing an instruction injected
into an operator note) is blocked by two deterministic policies; approval is
impossible and the refusal itself becomes a hashed receipt.*

## Quickstart (no API key needed)

```bash
node --version   # >= 22
npm install
npm run dev
```

Open http://localhost:3000. **Replay mode works immediately** with bundled,
clearly labeled fixtures — no key, no network, no cost.

Six bundled scenarios cover the whole verdict space:

| Bundled scenario | What it demonstrates | Outcome |
| --- | --- | --- |
| `INC-4821 — Degraded primary uplink` | A minimal, well-evidenced failover with a verified rollback passes every policy, so the decision is genuinely yours. | LOW · approvable |
| `INC-5133 — Transit route flapping` | A sound change that never says how success would be confirmed earns one warning. | MEDIUM · approvable |
| `INC-5290 — Egress load imbalance` | Warnings accumulate: two devices touched *and* no precondition. | HIGH · approvable |
| `INC-4977 — Suspected route leak` | A confident proposal obeys an instruction injected into an operator note and would sever the only management path to a protected firewall. | CRITICAL · blocked |
| `INC-5341 — Replication window overrun` | The proposal *has* a rollback — it just restores the wrong value, which replaying it on a sandboxed copy proves. | CRITICAL · blocked |
| `INC-5388 — Intermittent access-layer loss` | A one-device incident answered with a three-device "while we're in there" change. | CRITICAL · blocked |

Every scenario declares its expected verdicts in an `expectations.json` that
CI verifies against the real engine — so these claims are tested, not
advertised. Adding scenarios is the most valuable contribution: see
[docs/SCENARIO_AUTHORING.md](docs/SCENARIO_AUTHORING.md).

## How it works

```text
            untrusted input (incident bundle, plan, context)
                          │
              ┌───────────▼───────────┐   server-side; structured output +
              │  ① AI PROPOSAL        │   local Zod re-validation; invented
              │  live model or replay │   evidence/resources hard-rejected
              └───────────┬───────────┘
                          │ typed proposal (data, never commands)
              ┌───────────▼───────────┐   pure policies; risk derived only
              │  ② DETERMINISTIC GATE │   from PASS/WARN/BLOCK; model
              │  policies + risk      │   confidence has no input
              └───────────┬───────────┘
                 any BLOCK │ no BLOCK
              ┌─────▼─────┐ ┌───▼────────────┐
              │  BLOCKED  │ │ ③ HUMAN DECIDES│  approve / reject
              └─────┬─────┘ └───┬────────────┘
                    │     approve│
                    │  ┌─────────▼──────────┐  transactional patch on a deep
                    │  │ ④ SANDBOX SIMULATE │  clone; safety properties
                    │  └─────────┬──────────┘  re-checked; nothing real
              ┌─────▼────────────▼──────────┐
              │ ⑤ HASHED CHANGE RECEIPT     │  SHA-256 over canonical JSON
              └─────────────────────────────┘
```

- **Schemas first** (`packages/core/src/`) — Zod is the single source of
  truth; fixtures, model output, findings, and receipts all parse through
  the same schemas.
- **Explicit state machine** (`packages/core/src/state-machine.ts`) — every
  workflow arrow is a case; `BLOCKED → APPROVED` and `BLOCKED → SIMULATED`
  throw, no matter who calls.
- **Patch engine** (`packages/domain-network/src/`) — allowlisted path
  families, transactional apply on a `structuredClone`, structured diff,
  inverse derivation, rollback verified by canonical equality.
- **Policies** — universal ones in `packages/core/src/policies/`
  (`PATCH_SCHEMA`, `BLAST_RADIUS`, `ROLLBACK_COMPLETE`,
  `VERIFICATION_REQUIRED`, `UNTRUSTED_INSTRUCTION`) and network ones in
  `packages/domain-network/src/policies/` (`MGMT_REACHABILITY`,
  `PROTECTED_RESOURCE`): pure functions, each fail-closed, none may import
  AI code.
- **Receipts** (`packages/core/src/receipt.ts`) — canonical sorted-key
  serialization, SHA-256 input/proposal hashes, and a self-hash over
  everything except the hash field.

Deeper reading: [architecture](docs/ARCHITECTURE.md) ·
[threat model](docs/THREAT_MODEL.md) · [roadmap](docs/OSS_ROADMAP.md)

## Live model mode (optional)

```bash
cp .env.example .env.local     # add OPENAI_API_KEY=...
npm run dev
```

The header badge switches from `replay only` to `live available` and an
analyze-with-model button appears. Model calls run **only** server-side; the
key never reaches the browser, and a failed live call offers an explicit
switch to replay — never a silent substitution.

Today the adapter targets the OpenAI Responses API with Structured Outputs.
Provider-agnostic adapters (Anthropic, local models) are roadmap P5 — because
the gate is deterministic, swapping models cannot change what is safe.

### Replay vs live, honestly

Replay skips **only** the network call. Fixtures carry explicit provenance
(`authored_synthetic`, `authored_red_team`, or `captured_gpt_5_6` with
capture metadata), are validated by the same schemas as live output, and run
the identical validation → policy → decision → simulation → receipt
pipeline. The UI labels replay output as fixture content and never presents
it as a live model call. Both bundled fixtures today are **authored**, and
say so on screen.

## Commands

```bash
npm run dev        # start the app
npm run lint       # eslint
npm run typecheck  # tsc --noEmit (strict)
npm test           # vitest unit + integration (no network, no API credit)
npm run build      # production build
npm run build:cli  # bundle the changesafe CLI
npm run test:e2e   # Playwright critical paths (replay mode, keyless)
```

One-time before `test:e2e`: `npx playwright install chromium`.

Optional live smoke test (spends API credit, never runs by default):

```bash
CHANGESAFE_LIVE_SMOKE=1 npm test
# additionally capture a provenance-stamped fixture:
CHANGESAFE_LIVE_SMOKE=1 CHANGESAFE_CAPTURE_FIXTURE=1 npm test
```

## Gate an AI-generated Terraform pull request

The flagship use: your pipeline already produces `terraform show -json`.
ChangeSafe reads that artifact — it never runs Terraform, never holds
credentials for your infrastructure, and never applies anything.

```yaml
- name: ChangeSafe gate
  uses: wonkwonlee/ChangeSafe@main
  with:
    plan: tfplan.json
    context: pr-body.txt   # untrusted text, scanned but never obeyed
```

A pull request that replaces a protected compliance bucket — with a body
telling the review tooling to approve it anyway:

```text
  ⛔ DESTRUCTIVE_OP       Plan destroys stateful resources
  ⛔ PROTECTED_RESOURCE   Plan destroys a protected resource
  ⚠️ REVERSIBILITY        Configuration is recoverable, data is not
  ⚠️ UNTRUSTED_INSTRUCTION  context ev-context-0 contains "Ignore previous safety rules"

  risk: CRITICAL — BLOCKED
```

The injected instruction changes nothing: the block comes from what the plan
*does*, not from reading the text. Copy
[the example workflow](examples/github-actions/gate-terraform-plan.yml) to
start.

Terraform is an **external-diff** domain — the plan is already the
simulation, so ChangeSafe reads the diff rather than computing one. It
therefore replaces `ROLLBACK_COMPLETE` (a plan has no inverse to verify)
with `REVERSIBILITY` (could this be put back?), and records why in the
adapter rather than silently dropping a check.

## Gate a change from the terminal or CI

The engine is a library, and the CLI is the same engine with **no AI
dependency** — nothing in the gate calls a model.

```bash
npm run build:cli
node packages/cli/dist/changesafe.js gate --scenario scenarios/scenario-b-route-leak
```

```text
  PASS   PATCH_SCHEMA           All operations are valid declarative patches
  BLOCK  MGMT_REACHABILITY      Change severs management reachability
  BLOCK  PROTECTED_RESOURCE     Change removes or disables a protected resource
  WARN   UNTRUSTED_INSTRUCTION  Incident content contains instruction-like language
  …
  4 PASS · 1 WARN · 2 BLOCK   risk: CRITICAL

  BLOCKED — this change cannot be approved.
```

Exit `0` means nothing blocked, `1` means blocked, `2` means the gate could
not evaluate at all — so a missing verdict never reads as approval. The CLI
gates and never approves: its receipts record `gate_only` or `blocked`, and
there is no `--auto-approve`. Full usage: [packages/cli/README.md](packages/cli/README.md).

## Packages

| Package | What it is |
| --- | --- |
| [`@changesafe/core`](packages/core/README.md) | The domain-agnostic gate: proposal contract, universal policies, risk derivation, workflow state machine, receipts, and the `DomainAdapter` contract. Depends on zod alone. |
| `@changesafe/domain-network` | The network domain: declarative device state, allowlisted transactional patch engine, deterministic reachability, sandboxed simulation, network policies. |
| `@changesafe/domain-terraform` | The Terraform domain: normalizes `terraform show -json` and polices destruction, protection, and reversibility. Read-only; never runs Terraform. |
| [`changesafe`](packages/cli/README.md) | The CLI: `gate`, `verify`, `scenario`. Ships pre-bundled to run under plain Node. |

A domain teaches core what a change *is* in its world; core's universal
policies then work unchanged. `packages/core/tests/standalone-domain.test.ts`
implements a complete toy domain in one file to show the whole contract.

## Where this is going

Next: provider-agnostic AI adapters (Anthropic, local models — because the
gate is deterministic, swapping models cannot change what is safe),
self-hosting with a SQLite ledger and signed receipts, and a public
red-team benchmark of AI-proposed changes. Full plan and phase gates:
[docs/OSS_ROADMAP.md](docs/OSS_ROADMAP.md).

## Design commitments

These do not change:

- **No execution path, ever** — no SSH/NETCONF/RESTCONF/SNMP, no vendor
  SDKs, no shell execution, no `terraform apply`. ChangeSafe analyzes,
  gates, and records; humans and their existing systems execute.
- **The gate is pure** — policies never call a model, read a clock, or use
  randomness, and never receive model confidence.
- **A BLOCK is final** — no UI, API, or CLI path approves a blocked
  proposal. There is no auto-approval feature and there never will be.
- **Honest provenance** — authored fixtures are never attributed to a model.

## Limitations

- The synthetic network model (reachability = physical path + covering
  routes) is deliberately simple; it demonstrates deterministic validation,
  not production routing semantics. Fidelity ladder is roadmap P7.
- Receipts prove integrity, not authorship — no signatures yet (roadmap P6).
- The decision path currently runs client-side in the demo app; moving it
  behind an authenticated server boundary is roadmap P6.
- Single user, no auth, no persistence; two bundled scenarios so far.

## Contributing

Scenarios, policies, and domains are all open. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) — the safety ground rules are short and
non-negotiable. Security reports: [SECURITY.md](SECURITY.md).

## History

ChangeSafe v0.1 was built during OpenAI Build Week 2026 but was not
submitted; it is now an independent open-source project.
[`BUILD_WEEK_CHANGELOG.md`](BUILD_WEEK_CHANGELOG.md) is kept as the
historical record of that work.

## License

MIT — see [LICENSE](LICENSE).
