# changesafe (CLI)

Gate AI-proposed infrastructure changes from a terminal or a CI job.

The CLI runs the same deterministic engine as the ChangeSafe console.

**The gate has no AI dependency.** `gate`, `verify`, and `scenario` never call
a model, so gating costs nothing, needs no credential, works offline, and
cannot be influenced by a model. Two commands do call one — `analyze` (ask a
model for a proposal, then gate it) and `eval` (measure a model) — and both
require you to say so explicitly. Neither can change a verdict.

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

## Analysing and gating in one step

`analyze` asks a provider for a proposal and hands it straight to the same
`gate` code path — same policies, same order, same exit codes. A model
proposal gets no shortcut for having been produced locally.

```bash
export ANTHROPIC_API_KEY=...
changesafe analyze --scenario scenarios/scenario-b-route-leak --provider anthropic
```

A failed or unusable model call exits `2`, never `0`: an analysis that did not
happen is a missing verdict, not a clean one. `--capture` writes a replay
fixture stamped with the model that produced it and when — the schema refuses
a `captured` claim without both, and refuses to let an authored fixture name
a model at all.

`eval` runs the whole scenario suite against a model and reports what fraction
of its answers were schema-valid, evidence-grounded, and blocked by the gate.
It requires an explicit `--provider` because it spends real credit, and
nothing in CI runs it.

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

changesafe analyze --scenario <dir>           # ask a model, then gate the answer
                [--provider openai|anthropic|ollama]
                [--model <id>]
                [--out <proposal.json>]       # the accepted proposal
                [--capture <fixture.json>]    # a provenance-stamped fixture
                [... every gate option above]

changesafe eval --provider <id>               # measure a model on the suite
                [--model <id>] [--dir scenarios] [--runs <n>]

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

## Integrity, and then authorship

`verify` recomputes hashes from canonical serializations and reports whether
a receipt still describes what it claims. That is **integrity**: it detects
alteration. It says nothing about who produced the receipt, because anyone
with the codebase can build an internally consistent one.

**Signing** closes that gap:

```bash
changesafe keygen --out ci-signing-key          # writes .pem (0600) and .pub.pem
changesafe gate --scenario ./change --receipt r.json --sign-key ci-signing-key.pem
changesafe verify r.json --public-key ci-signing-key.pub.pem
```

An Ed25519 signature covers the canonical receipt, hash included. The value
over hashing alone: someone who edits a receipt can simply recompute
`receiptSha256`, and the hash check will pass — the signature will not,
because they cannot produce one without the private key.

Three rules make the result mean something:

- **The envelope carries no public key.** Only a key fingerprint travels with
  the receipt. A verifier must obtain the real key out of band, so a receipt
  can never vouch for itself.
- **An unchecked signature is not a pass.** Verifying a signed receipt
  without `--public-key` exits `2` — a missing verdict about authorship, not
  a clean one. Pass `--skip-signature` to check integrity alone and have the
  signature reported as unverified.
- **Someone else's valid signature fails.** A receipt signed by a different
  key reports `key_mismatch`, never a near-miss.

The private key never leaves the machine that signs; `keygen` writes it mode
`0600` and refuses to overwrite an existing key without `--force`, because
replacing a key invalidates every receipt already signed with it.

## License

MIT — see the repository root.
