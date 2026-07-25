# ChangeSafe

[![CI](https://github.com/wonkwonlee/ChangeSafe/actions/workflows/ci.yml/badge.svg)](https://github.com/wonkwonlee/ChangeSafe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

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
node --version   # >= 20.9
npm install
npm run dev
```

Open http://localhost:3000. **Replay mode works immediately** with bundled,
clearly labeled fixtures — no key, no network, no cost.

| Bundled scenario | What it demonstrates |
| --- | --- |
| `INC-4821 — Degraded primary uplink` | A safe failover proposal passes all 7 policies (risk LOW). Approve it, watch the sandboxed simulation, download the hashed receipt. |
| `INC-4977 — Suspected route leak` | A red-team proposal tries to remove the only management route to a protected firewall. `MGMT_REACHABILITY` and `PROTECTED_RESOURCE` BLOCK it, `UNTRUSTED_INSTRUCTION` flags the injected note, risk is CRITICAL — approval is impossible in the UI *and* in the domain state machine. |

More scenarios are the most valuable contribution — see
[CONTRIBUTING.md](CONTRIBUTING.md).

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

- **Schemas first** (`lib/domain/schemas.ts`) — Zod is the single source of
  truth; fixtures, model output, findings, and receipts all parse through
  the same schemas.
- **Explicit state machine** (`lib/domain/state-machine.ts`) — every
  workflow arrow is a case; `BLOCKED → APPROVED` and `BLOCKED → SIMULATED`
  throw, no matter who calls.
- **Patch engine** (`lib/patch/`) — allowlisted path families,
  transactional apply on a `structuredClone`, structured diff, inverse
  derivation, rollback verified by canonical equality.
- **Policies** (`lib/policies/`) — `PATCH_SCHEMA`, `MGMT_REACHABILITY`,
  `PROTECTED_RESOURCE`, `BLAST_RADIUS`, `ROLLBACK_COMPLETE`,
  `VERIFICATION_REQUIRED`, `UNTRUSTED_INSTRUCTION`: pure functions, each
  fail-closed, none may import AI code.
- **Receipts** (`lib/receipt/`) — canonical sorted-key serialization,
  SHA-256 input/proposal hashes, and a self-hash over everything except the
  hash field.

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
npm run test:e2e   # Playwright critical paths (replay mode, keyless)
```

One-time before `test:e2e`: `npx playwright install chromium`.

Optional live smoke test (spends API credit, never runs by default):

```bash
CHANGESAFE_LIVE_SMOKE=1 npm test
# additionally capture a provenance-stamped fixture:
CHANGESAFE_LIVE_SMOKE=1 CHANGESAFE_CAPTURE_FIXTURE=1 npm test
```

## Where this is going

The console you can run today is the showcase. The roadmap is
**library- and CLI-first**:

1. `@changesafe/core` — the schemas, state machine, policies, patch engine,
   and receipts as an embeddable package.
2. `changesafe` CLI — `gate`, `verify`, `scenario` commands with CI-friendly
   exit codes and **no AI dependency** (the gate is fully deterministic).
3. **Terraform plan ingestion + a GitHub Action** — gate AI-generated infra
   PRs from `terraform show -json` output, with no infrastructure access at
   all. This is the flagship real-world domain.

Then: provider-agnostic AI adapters, self-hosting (SQLite ledger, signed
receipts), and a public red-team benchmark. Full plan and phase gates:
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
