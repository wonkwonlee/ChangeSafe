# ChangeSafe v0.1.1

A security and correctness patch. Nothing about the trust model changes: AI
proposes, deterministic code validates, a human decides, and ChangeSafe still
executes nothing.

**Everyone using the GitHub Action should update.** One of these fixes is in
the example workflow the README tells you to copy, so updating the Action
version is necessary but — for that one — not sufficient. See *Action
required* below.

```yaml
- uses: wonkwonlee/ChangeSafe@v0.1.1
```

## Action required if you copied the example workflow

Before this release, `examples/github-actions/gate-terraform-plan.yml`
captured the pull request body like this:

```yaml
- name: Capture the pull request body
  run: |
    cat <<'CHANGESAFE_PR_BODY' > pr-body.txt
    ${{ github.event.pull_request.body }}
    CHANGESAFE_PR_BODY
```

A `${{ }}` expression is substituted into the script *before* bash parses it,
so the quoted heredoc does not protect the delimiter. A pull request whose
body contains a line equal to `CHANGESAFE_PR_BODY` closes the heredoc, and
everything after it runs as shell commands in the runner — in the workspace,
before the gate reads the plan. That is enough to rewrite `tfplan.json` or
`pr-body.txt` and get a clean verdict on a change the gate never saw.

Updating the `uses:` pin does **not** fix a copy already sitting in your
repository. Replace that step with:

```yaml
- name: Capture the pull request body
  env:
    CHANGESAFE_PR_BODY: ${{ github.event.pull_request.body }}
  run: printf '%s' "$CHANGESAFE_PR_BODY" > pr-body.txt
```

The body still reaches the gate as untrusted text that is scanned and never
obeyed. It just stops reaching the shell.

## Fixed

**The Action no longer lets untrusted text act.**

- The example workflow passes the pull request body through the environment
  instead of interpolating it into a script (above).
- `action.yml` does the same with its own inputs, which were interpolated
  into the gate script and would have carried the same power for any input
  assembled from event data.
- The pull request comment can no longer be forged. `UNTRUSTED_INSTRUCTION`
  quotes the matched excerpt of the body verbatim, and a `|` in that excerpt
  opened new Markdown table cells — enough to render a passing verdict beside
  the real one. Characters that carry table structure are now neutralized.

**The gate reaches a verdict instead of falling over.**

- A policy that throws is recorded as `BLOCK` under its own id rather than
  abandoning the evaluation. "All policies fail closed" now holds for a policy
  with a bug in it, not only for one that reaches a considered verdict.
- Identifiers from outside are looked up as own properties. `constructor` is
  valid kebab-case, so `/devices/constructor/routes/x` used to return
  `Object.prototype.constructor`, pass the existence check, and raise a
  `TypeError` from inside a policy — printing a raw JavaScript message and
  exiting 2. It is now the typed "unknown device" refusal, exit 1.
- Terraform address globs are matched directly instead of compiled to a
  regex. Twelve `*` against a 400-character address used to run past thirty
  seconds, and a gate that never answers is a CI job that never finishes.

**The self-hosted server answers honestly.**

- `serve` gained `--approver <subject>` and `--approver-claim <name>=<value>`.
  Authentication says who someone is; these say which of those people may act
  here. A genuine but unlisted identity gets 403, not 401. With neither flag
  the behavior is unchanged and startup says so out loud.
- A token that could not be decoded returned 500, an oversized body claimed a
  schema mismatch nobody had checked, and malformed JSON returned 500. They
  now answer 401, 413, and 400.
- `GET /decisions?limit=abc` reached SQLite as `LIMIT NaN` and returned 500.
- Identity-provider key documents are fetched over https only (loopback
  excepted), under a deadline and a size cap, and filtered to signing keys for
  the token's algorithm.

**The ledger orders simultaneous decisions.** Two approvers deciding at once
both read the same chain head, and the second collided on the sequence number
the first had taken — a legitimate decision returning an internal error.
Appends now queue. The database constraint stays, because it is what catches a
second *process*.

**Live analyses are capped per client.** `POST /api/analyze` is
unauthenticated by design, so a deployment with a provider key was spending
its owner's credit at whatever rate was asked. Live calls now count against a
window (`CHANGESAFE_LIVE_RATE_LIMIT`, default 10/hour, `0` disables) and
answer 429 before reaching a provider. Replay stays uncapped — it costs
nothing, and the promise that anyone can drive the whole gate without an
account is the demo. The cap is a speed bump, not a defense, and the README
says so: it counts in one process's memory and trusts a forwarded header.

**The CLI stopped announcing an experimental database it never opens.** The
bundled CLI loaded `node:sqlite` on every command, so `changesafe gate`
printed an `ExperimentalWarning` to stderr on every CI run. It is now loaded
when a ledger is actually opened.

## Verdicts did not change

No policy behavior changed for any input that previously produced a verdict.
All nine scenarios match their expectations unchanged, and the published
v0.1.0 verification snapshot still reproduces byte-for-byte
(`npm run verify:v0.1.0`). `CORE_POLICY_VERSION`, `NETWORK_POLICY_VERSION`,
and `TERRAFORM_POLICY_VERSION` are therefore unchanged, and receipts issued by
v0.1.0 and v0.1.1 remain comparable.

The fail-closed guard is the one addition that can produce a finding that did
not exist before — but only where the alternative was no findings, no risk,
and no receipt at all.

## Version strings deliberately did not move

`changesafe-cli-0.1.0` still appears as `appVersion` in CLI receipts, and
`package.json` still reads `0.1.0`. That is not an oversight:
`npm run verify:v0.1.0` re-runs the current CLI against the published bundle
and requires the replayed receipt to be canonically identical to the signed
one, and `appVersion` is inside that receipt. Moving the string would mean the
v0.1.0 snapshot no longer reproduces from this repository.

The honest resolution is that the snapshot should reproduce from the code at
its own tag rather than from the working tree, which is now possible because
tags exist. That is a v0.2.0 change, not a patch-release change — it touches
the release verifier, which is exactly the tool a release should not be
quietly modifying.

Nothing is published to npm, so no package version is implied by this. The
git tag names the release.

## Upgrading

| From | Do |
| --- | --- |
| The Action, any pin | Move to `@v0.1.1`, and fix a copied example workflow (above) |
| The CLI or library, from source | Pull `main`; no API changed |
| The self-hosted server | No change required. Consider `--approver` / `--approver-claim` — without them, every identity your issuer vouches for may approve |
| The app with live mode public | Nothing required. Consider `CHANGESAFE_LIVE_RATE_LIMIT`, and read the README note on what the cap is not |

## Verification

```bash
npm run verify:v0.1.0   # the published snapshot still reproduces
npm test                # 440 passing
npm run build:cli && node packages/cli/dist/changesafe.js scenario check
```
