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

## What is in the box

| Package | Purpose |
| --- | --- |
| `@changesafe/core` | Proposal contract, five universal policies, deterministic risk, workflow state machine, receipts. Depends on zod alone. |
| `@changesafe/domain-network` | Declarative device state, allowlisted transactional patch engine, reachability, sandboxed simulation. |
| `@changesafe/domain-terraform` | Normalizes plan JSON; polices destruction, protection, and reversibility. |
| `changesafe` | The CLI, pre-bundled to run under plain Node. |

Plus a one-page console with six bundled scenarios covering the whole
verdict space, from a clean approval to three different ways a plausible
change gets blocked.

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
- Receipts prove integrity, not authorship — they are unsigned in v0.1.
- The synthetic network model is deliberately simple; it demonstrates
  deterministic validation, not production routing semantics.
- The console's decision path runs client-side; moving it behind an
  authenticated server boundary is planned.
- Bundled AI fixtures are authored and labeled as such, not captured model
  output.

## Contributing

Scenarios are the easiest and most valuable way in. Each one declares its
expected verdicts in a file CI checks against the real engine, so a scenario
cannot claim something the gate does not do. See
[docs/SCENARIO_AUTHORING.md](../docs/SCENARIO_AUTHORING.md), which lists the
coverage gaps worth filling.

## History

Built during OpenAI Build Week 2026 but not submitted; now an independent
open-source project. MIT licensed.
