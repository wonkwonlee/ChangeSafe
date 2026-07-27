# v0.2.0 — first published release

Status: adopted 2026-07-27. Owner decisions recorded below are settled; the
open questions are marked as such.

v0.1.1 made the GitHub Action installable by tagging it. v0.2.0 makes the
*library and CLI* installable, which is the adoption path
`docs/OSS_ROADMAP.md` §1 calls the engine: "an embeddable library and a
CI-friendly command-line gate".

Nothing about the trust model changes, and no policy behavior changes.

## What ships

| # | Workstream | Decision |
| --- | --- | --- |
| W1 | Version bump to 0.2.0 | in |
| W2 | Snapshot verification survives a moving build identity | in — option C |
| W3 | Publish `changesafe` (CLI) to npm | in |
| W4 | Publish `@changesafe/core`, `domain-network`, `domain-terraform` | in |
| — | Publish `ai`, `ledger`, `server` | deferred to v0.3.0 |

`@changesafe` and the unscoped `changesafe` were both unclaimed on the
registry when this plan was adopted.

## W1 — what moves, and what deliberately does not

**Moves** (package identity and build identity):

- every workspace `package.json` and the repository root: `0.1.0` → `0.2.0`
- inter-package dependency ranges: `"0.1.0"` → `"^0.2.0"`
- `CLI_APP_VERSION` / `SERVER_APP_VERSION` (`packages/cli/src/version.ts`)
- `APP_VERSION` (`lib/domain/version.ts`)

**Does not move**: `CORE_POLICY_VERSION`, `NETWORK_POLICY_VERSION`,
`TERRAFORM_POLICY_VERSION`.

These are two different families and confusing them is the expensive mistake.
Build identity says *which binary ran*; policy version says *which gate
decided*. Bumping the second alongside the first would announce a rule change
that did not happen, in every receipt, and would make receipts from adjacent
releases read as incomparable. `tests/integration/version-sync.test.ts` holds
both halves of that line: build identity must track its package version, and
policy versions must stay where they are.

## W2 — the published snapshot has to keep reproducing

`npm run verify:v0.1.0` re-runs the **current** CLI against the published
v0.1.0 bundle and requires the replayed receipt to be canonically identical to
the signed one. `appVersion` lives inside that receipt, so moving the build
identity breaks the check — a release gate failing as a side effect of a
version bump.

Options considered:

| | Approach | Verdict |
| --- | --- | --- |
| A | Reproduce from the recorded `sourceCommit` by checking it out and building there | Strongest, but verification would need an install and a build of historical code — slow and brittle |
| B | Drop byte equality; assert findings and risk match instead | Cheap, but weakens what the snapshot proves |
| **C** | **Let the audited replay stamp the recorded identity: `--app-version`** | **Chosen** |
| D | Freeze the build identity forever | Rejected: a receipt that lies about which build made it |

**C is chosen.** The CLI already carries `--receipt-id` and `--created-at`
for exactly this purpose — fixing receipt identity when regenerating an
audited snapshot — and `--app-version` joins that family. The claim the
snapshot makes becomes precise: *told to stamp the same identity, today's gate
reproduces this receipt to the byte.*

On the obvious objection — a flag that writes an arbitrary build identity
into a receipt: `--created-at` already lets a caller write an arbitrary time,
and an unsigned receipt proves nothing about authorship by design (safety
invariant 11). Anyone holding the signing key can write whatever they like
regardless. The flag weakens nothing that was strong.

Known limit, recorded so it is not rediscovered: if the receipt *structure*
ever changes, byte equality breaks whatever the identity says. At that point
the honest move is A, or redefining the snapshot's guarantee as signature plus
recorded expectations. That is a v0.3+ problem.

## W3 — publishing the CLI

The mechanism landed with `.github/workflows/publish.yml`: it runs on a
published GitHub release and refuses rather than guesses — tag must equal the
package version, the version must not already exist on npm, the full gate must
pass on the tagged commit, and the packed tarball must install into a bare
project and gate a destructive plan to exit 1. It publishes with
`--provenance`.

Requires an `NPM_TOKEN` repository secret before the first release.

## W4 — publishing the libraries

The blocker looked larger than it is. Two facts settle the design:

1. **npm does not apply `publishConfig` field overrides.** Verified by packing
   a probe package: `main` stayed `./src/index.ts` in the tarball. (That is a
   pnpm feature, not an npm one.) So the package must genuinely point at
   compiled output.
2. **The workspace does not resolve through `package.json`.**
   `vitest.config.ts` aliases and `tsconfig.json` paths map `@changesafe/*`
   straight to source. Pointing `main`/`types`/`exports` at `dist` therefore
   costs the workspace nothing — the only reader of those fields is an
   external installer, which is exactly who should get `dist`.

So: a per-package `tsconfig.build.json` emitting JS plus `.d.ts` via plain
`tsc` (no bundler, no new dependency), `files: ["dist"]`, and the workspace
keeps consuming TypeScript source with no build step in the test loop.

Two consequences surfaced during implementation and are worth recording.

`tsc` rewrites no import specifiers, so extensionless relative imports emit
JavaScript that Node refuses and declarations that NodeNext consumers reject.
Adding `.js` to the *source* is the usual fix and does not work here: the app
imports these packages as TypeScript, and Turbopack does not resolve a `.js`
specifier to a `.ts` file, so the app stops building. The extensions are added
to the build output instead, by `scripts/finish-package-build.mjs`, which
fails loudly on anything it cannot resolve.

The build configs also drop the repository's `paths`, so a domain package
resolves `@changesafe/core` through node_modules — against the declarations
that actually ship — which is why core builds first.

Each package gets a pack-install-import smoke test. This is not optional:
packaging the CLI turned up two defects that only exist once someone installs
rather than clones — dependencies that could not resolve, and a binary that
exited 0 without evaluating anything when reached through npm's `bin`
symlink. Cloning would never have shown either.

## Sequence

| PR | Contents | Depends on |
| --- | --- | --- |
| 1 | `--app-version` + verifier and builder pin the snapshot identity; this plan | — (merged) |
| 2 | Library build pipeline + pack smoke tests | — (merged) |
| 3 | Version bump to 0.2.0 across the workspace | 1, 2 (merged) |
| 4 | Release notes, pins, publish workflow covers all four packages | 3 |

PR 1 must land before PR 3. Reversed, the version bump turns the release gate
red and the verifier gets repaired while the gate is broken — fixing the gate
with the gate down.

## Open

- ~~`NPM_TOKEN` secret (owner).~~ Added 2026-07-27.
- ~~Whether inter-package ranges publish as `^0.2.0` or exact pins.~~ Caret,
  as assumed: exact pins would force consumers to upgrade the set in lockstep.
- GitHub Marketplace listing for the Action, now that it no longer builds
  itself at consumer runtime. Independent of this release.
