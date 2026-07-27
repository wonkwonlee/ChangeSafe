# ChangeSafe v0.2.0

**The engine is installable.** v0.1.1 made the GitHub Action usable by tagging
it; this release puts the library and the CLI on npm, which is the adoption
path the roadmap has always described — *an embeddable library and a
CI-friendly command-line gate*.

Nothing about the trust model changes. No policy behavior changes, and no
verdict changes.

```bash
npx changesafe gate --domain terraform --input tfplan.json
```

```bash
npm i @changesafe/core @changesafe/domain-terraform
```

| Package | What it is |
| --- | --- |
| [`changesafe`](https://www.npmjs.com/package/changesafe) | The CLI: `gate`, `analyze`, `eval`, `verify`, `keygen`, `ledger`, `serve`, `scenario`. One bundled file, no dependencies |
| [`@changesafe/core`](https://www.npmjs.com/package/@changesafe/core) | The domain-agnostic gate: proposal contract, universal policies, risk derivation, workflow state machine, receipts, the `DomainAdapter` contract. Depends on zod alone |
| [`@changesafe/domain-network`](https://www.npmjs.com/package/@changesafe/domain-network) | The network domain: declarative state, allowlisted transactional patches, deterministic reachability, sandboxed simulation |
| [`@changesafe/domain-terraform`](https://www.npmjs.com/package/@changesafe/domain-terraform) | The Terraform domain: normalizes `terraform show -json` and polices destruction, protection, and reversibility. Never runs Terraform |

`@changesafe/ai`, `@changesafe/ledger`, and `@changesafe/server` stay
unpublished for now; they are the self-hosting pieces and join in v0.3.0.

Every package is published with npm **provenance**, so the registry records
which workflow, repository, and commit produced each tarball.

## Embedding the gate

```ts
import { evaluatePolicies, hasBlockingFinding } from "@changesafe/core";
import { networkDomain } from "@changesafe/domain-network";

const { findings, riskLevel } = evaluatePolicies(networkDomain, incident, proposal);
if (hasBlockingFinding(findings)) {
  // Nothing in this library can approve it. That is the point.
}
```

A `DomainAdapter` teaches core what a change means in your world; the
universal policies then work unchanged. `packages/core/tests/standalone-domain.test.ts`
implements a complete toy domain in one file if you want the shape of it.

## What changed since v0.1.1

**The packages ship compiled JavaScript and declarations** instead of
TypeScript source, so `npm i` works and editors resolve types. The workspace
still develops against source — no build step joined the test loop.

**The Action no longer builds itself in your CI.** It previously ran
`npm ci` on this whole repository inside every consumer's workflow before
evaluating a single policy. The CLI bundle is committed and executed
directly; CI rebuilds it and fails if the committed bytes differ from the
source, so what runs in your pipeline is what was reviewed here.

**`changesafe gate` no longer prints an experimental-SQLite warning** on every
run. The ledger's `node:sqlite` import is loaded when a ledger is opened.

**`--app-version`** joins `--receipt-id` and `--created-at` for regenerating
or re-verifying an audited snapshot with a later build. Ordinary runs record
this build's own identity and need nothing.

## Version numbers, and one that stayed put

Package versions and build identity move to 0.2.0: receipts now record
`appVersion: "changesafe-cli-0.2.0"`.

The **policy versions did not move** — `core-v0.1.0`, `network-v0.1.0`,
`terraform-v0.1.0` — because no policy behavior changed. They answer a
different question from the release number: *which gate decided*, not *which
binary ran*. A receipt from v0.1.1 and one from v0.2.0 therefore remain
directly comparable, and `policyVersion` still means what it has always meant.
`tests/integration/version-sync.test.ts` enforces both halves of that.

The published v0.1.0 verification snapshot still reproduces byte for byte
(`npm run verify:v0.1.0`) across this bump.

## Upgrading

| Your situation | Do |
| --- | --- |
| Using the Action | Move the pin to `@v0.2.0` (or `@v0` to track patches). Nothing else changes |
| Vendoring the repository to get the engine | `npm i @changesafe/core` and delete the vendored copy |
| Running the CLI from a clone | `npm i -g changesafe`, or `npx changesafe`. The clone still works |
| Self-hosting the decision server | No change. `@changesafe/server` is still consumed from source until v0.3.0 |

## Verification

```bash
git checkout v0.2.0
npm ci
npm run verify:v0.1.0   # the published v0.1.0 snapshot still reproduces
npm test                # 448 passing, 2 skipped
npm run build:cli && node packages/cli/dist/changesafe.js scenario check   # 9/9
```

The red-team corpus still refuses every proposal it is supposed to refuse,
including when the gate is reached through the installed packages rather than
this workspace — `tests/integration/publishable-packages.test.ts` gates the
route-leak scenario through unpacked tarballs and requires CRITICAL.
