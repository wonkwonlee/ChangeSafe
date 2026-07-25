# ChangeSafe v0.1.0

A deterministic airlock for AI-proposed infrastructure changes.

An AI proposes a change. ChangeSafe treats that proposal as untrusted data:
pure policies validate it, a human decides, and every outcome — approved,
rejected, or blocked — becomes a hashed receipt.

**[Live demo](https://change-safe.vercel.app)** · no signup, no API key.

## What you can do with this release

**Gate Terraform pull requests in CI, with no infrastructure access.**
ChangeSafe reads the `terraform show -json` artifact your pipeline already
produces. It never runs Terraform and holds no credentials.

```yaml
- uses: wonkwonlee/ChangeSafe@v0.1.0
  with:
    plan: tfplan.json
    context: pr-body.txt   # untrusted text: scanned, never obeyed
```

**Gate from a terminal.** `changesafe gate`, `verify`, and `scenario`, with
exit codes CI can act on: `0` nothing blocking, `1` blocked, `2` could not
evaluate. The last is deliberate — a missing verdict must never read as
approval.

**Embed the engine.** `@changesafe/core` is the domain-agnostic gate;
a `DomainAdapter` teaches it what a change means in your world.

**Use live models without changing the safety boundary.** OpenAI, Anthropic,
and local Ollama adapters can propose changes through `changesafe analyze`.
`changesafe eval` measures schema validity, evidence grounding, and red-team
outcomes against the versioned scenario corpus. The deterministic gate remains
provider-independent.

**Sign and attribute decisions.** Receipts can be signed with Ed25519 using
`changesafe keygen`, `--sign-key`, and `verify --public-key`. For teams,
`changesafe serve` provides an optional OIDC-authenticated decision path that
recomputes findings server-side, records the approver, signs the receipt, and
appends it to a hash-chained SQLite ledger.

## What is in the box

| Package | Purpose |
| --- | --- |
| `@changesafe/core` | Proposal contract, five universal policies, deterministic risk, workflow state machine, receipts. Depends on zod alone. |
| `@changesafe/domain-network` | Declarative device state, allowlisted transactional patch engine, reachability, sandboxed simulation. |
| `@changesafe/domain-terraform` | Normalizes plan JSON; polices destruction, protection, and reversibility. |
| `changesafe` | The CLI, pre-bundled to run under plain Node. |
| `@changesafe/ai` | Provider-neutral proposal layer for OpenAI, Anthropic, and Ollama. |
| `@changesafe/ledger` | Append-only SQLite decision ledger with tamper-evident hash chaining. |
| `@changesafe/server` | OIDC-authenticated server-side decision path that recomputes the gate. |

Plus a one-page console with nine bundled network scenarios: six adversarial,
all nine currently defined failure modes covered, and one approvable scenario
that is still flagged by sandbox simulation.

## The commitments

These do not change:

- **No execution path.** No SSH, no vendor SDKs, no shell, no
  `terraform apply`. ChangeSafe analyzes, gates, and records.
- **The gate is pure.** Policies never call a model, read a clock, or use
  randomness, and never receive model confidence.
- **A block is final.** No UI, API, or CLI path approves a blocked change.
  There is no `--auto-approve` and there will not be one.
- **Skipping a check requires a reason.** A domain may decline a universal
  policy only by recording why and naming its replacement, and the skip is
  visible in the policy order.
- **Honest provenance.** Authored fixtures are never attributed to a model.

## Known limits

- Two domains: network and Terraform.
- Receipt signing is optional. An unsigned receipt proves integrity, not
  authorship; signature verification requires the expected public key.
- The synthetic network model is deliberately simple and demonstrates
  deterministic validation rather than production routing semantics.
- The public console keeps its keyless decision path client-side. Teams that
  need authenticated attribution must deploy the separate self-hosted server.
- The benchmark corpus is small and synthetic: nine network scenarios, six
  adversarial. It is a coverage instrument, not a statistical safety score.
- One bundled fixture is captured GPT-5.6 output; the other eight are authored.
  All fixtures explicitly declare and validate their provenance.
- ChangeSafe gates and records changes but never executes them.

## Contributing

Scenarios are the easiest and most valuable way in. Each one declares its
expected verdicts in a file CI checks against the real engine, so a scenario
cannot claim something the gate does not do. See [docs/SCENARIO_AUTHORING.md](../docs/SCENARIO_AUTHORING.md) for the
authoring contract and [docs/SCENARIOS.md](../docs/SCENARIOS.md) for the
generated, CI-checked coverage table.

## History

Built during OpenAI Build Week 2026 but not submitted; now an independent
open-source project. MIT licensed.
