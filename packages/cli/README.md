# changesafe (CLI)

Gate AI-proposed infrastructure changes from a terminal or a CI job.

The CLI runs the same deterministic engine as the ChangeSafe console, with
**no AI dependency** — nothing here calls a model, so the gate costs nothing
and cannot be influenced by one.

```bash
npm run build:cli                                   # build the bundled binary
node packages/cli/dist/changesafe.js gate --scenario scenarios/scenario-b-route-leak
```

```text
  ChangeSafe gate · domain network · input inc-route-leak-4977
  proposal provenance: authored_red_team

  PASS   PATCH_SCHEMA           All operations are valid declarative patches
  BLOCK  MGMT_REACHABILITY      Change severs management reachability
         After applying the proposal to a sandboxed copy, the management
         origin "mgmt-01" can no longer reach: dist-fw-01 …
  BLOCK  PROTECTED_RESOURCE     Change removes or disables a protected resource
  …
  4 PASS · 1 WARN · 2 BLOCK   risk: CRITICAL

  BLOCKED — this change cannot be approved.
```

## Terraform plans

```bash
terraform show -json tfplan > tfplan.json
changesafe gate --domain terraform --input tfplan.json --context pr-body.txt
```

The Terraform domain derives the proposal from the plan itself — the plan
already states what will change — so `--proposal` is neither needed nor
accepted. `--context` carries text that travelled with the change (a pull
request body); it is scanned for injected instructions and never obeyed.

Its policy set differs from the network domain's, and says why:
`ROLLBACK_COMPLETE` is replaced by `REVERSIBILITY` because a plan has no
inverse operations to verify, and `VERIFICATION_REQUIRED` is skipped because
plan JSON contains no verification plan — in this workflow the pull request
review is that step.

## It gates; it never approves

There is no `--auto-approve`, and there never will be. A clean run means
*no policy blocked this change* — an input to a human decision, which in CI
is the pull request review. Receipts written by the CLI record
`decision: "gate_only"` or `"blocked"`, never `"approved"`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Evaluated; nothing blocking |
| `1` | Evaluated; **blocked** |
| `2` | Could not evaluate: bad usage, unreadable input, failed validation |

The gap between `1` and `2` is deliberate. A `1` is a verdict. A `2` is a
*missing* verdict and must never be treated as approval.

## Commands

```bash
changesafe gate --scenario <dir>              # or: --input <file> --proposal <file>
                [--domain network]
                [--policy-pack <file>]        # typed threshold overrides
                [--receipt <out.json>]        # write a hashed record
                [--format pretty|json]

changesafe verify <receipt.json>              # recompute the receipt's hashes
                [--input <file>] [--proposal <file>]   # and check it describes these

changesafe scenario check [dir]               # scenarios vs their expectations.json
changesafe scenario init <name>               # scaffold a scenario that passes its own check
```

`--proposal` accepts either a bare proposal or a replay fixture wrapping
one; when it is a fixture, the declared provenance is carried into the
receipt.

## Policy packs

A pack tunes thresholds teams legitimately disagree about. It is
deliberately **not** a policy language — no expressions, no interpreter — so
a pack cannot make the gate unsound.

```json
{
  "name": "strict-change-window",
  "blastRadius": { "warnAt": 1, "blockAbove": 2 },
  "verification": { "requirePrecondition": true, "requirePostcheck": true }
}
```

## In CI

```yaml
- run: npm run build:cli
- run: node packages/cli/dist/changesafe.js gate --scenario ./change --receipt receipt.json
- uses: actions/upload-artifact@v4
  with:
    name: changesafe-receipt
    path: receipt.json
```

A blocking finding fails the step. The receipt is the durable evidence of
what the gate saw, verifiable later with `changesafe verify`.

## Verification is integrity, not authorship

`verify` recomputes hashes from canonical serializations and reports whether
a receipt still describes what it claims. Receipts are unsigned in this
version, so this detects alteration and mismatch — not forgery by someone
with the codebase. Signing is on the roadmap.

## License

MIT — see the repository root.
