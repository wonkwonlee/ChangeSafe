# ChangeSafe v0.4.1

This release completes v0.4.0. It contains no product changes: the code is
v0.4.0 plus a fix to the release workflow. Policy versions are unchanged, so
receipts from v0.3.1, v0.4.0, and v0.4.1 all remain comparable.

Read [RELEASE_NOTES_v0.4.0.md](RELEASE_NOTES_v0.4.0.md) for what actually
shipped — the multi-domain workbench, the 26-scenario corpus, and the four
security and hygiene fixes.

## Why this version exists

v0.4.0 published three of its five packages and then stopped:

| Package | v0.4.0 |
| --- | --- |
| `@changesafe/core` | published, with provenance |
| `@changesafe/domain-network` | published, with provenance |
| `@changesafe/domain-terraform` | published, with provenance |
| `@changesafe/domain-kubernetes` | **not published** |
| `changesafe` | **not published** |

`@changesafe/domain-kubernetes` had no trusted-publisher configuration on npm
— it was created by a manual publish during the v0.3.0 bootstrap and never
wired up — so the registry answered `404` on `PUT`, and the loop exited before
reaching the CLI. That configuration is now in place.

**Use v0.4.1.** The three packages published at 0.4.0 are genuine and carry
provenance, but 0.4.0 is not a complete set: the CLI and the Kubernetes domain
do not exist at that version. Nothing published at 0.4.0 is broken or
withdrawn — `@changesafe/core@0.4.0` and the two domains that shipped with it
install and work — but only 0.4.1 gives you all five.

## What changed in the release machinery

Publishing the workspace is five separate registry calls, and the workflow
refused to run if *any* version already existed. That made a partial publish
unrecoverable except by hand, which is how v0.3.x lost its provenance. A
version already on the registry is now skipped rather than refused, so a
resumed run sends only what is missing and says which packages it skipped.

The selection lives in `scripts/select-unpublished.sh` with test coverage for
the states that matter — nothing published, a partial failure, everything
published, a version mismatch, and a registry lookup that fails — because the
failure mode here is silent: skipping a package that was never published
produces an incomplete release that still reports success.

One thing worth recording for whoever recovers the next partial publish: a
`release` event runs the workflow file **at the tagged commit**, not the one
on `main`. Fixing the workflow after tagging does not fix that release. That
is why v0.4.0 could not simply be re-published, and why this is a new version
rather than a retry.
