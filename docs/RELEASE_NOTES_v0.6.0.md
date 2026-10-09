# v0.6.0 — unreleased candidate

Status: prepared source, not published. Published v0.5.0 remains the last
release described by the README's pinned installation examples. This
candidate does not mark M2/M3 formally closed; see `M2_CLOSEOUT.md`.

## Resulting behavior

- Authenticated durable HTTP accepts immutable Kubernetes snapshot/manifest
  bundles and derives grant bindings on the server. Caller-selected binding
  fields are refused. One review supports one resource operation.
- Grant intent and the signed grant persist separately from receipt evidence;
  identical retries recover one receipt-derived capability identity.
- The runnable enforcer requires persistent SQLite single-use state. Protected
  namespace downgrade/deletion and Scale/HPA bypasses are denied by native
  admission routing policies. Dry-run does not consume authority.
- The M3 protocol model checks bounded safety and requires five injected
  defect counterexamples plus the default-tier outage overclaim counterexample.

## What an installer receives

The existing five-package set remains: `@changesafe/core`,
`@changesafe/domain-network`, `@changesafe/domain-terraform`,
`@changesafe/domain-kubernetes`, and `changesafe`. Versions and workspace
ranges move together to 0.6.0. The CLI bundles the private server/ledger;
those packages and the enforcer are not newly published packages.
Admission deployment remains source-built from the matching release checkout
using `examples/m2-kubernetes-enforcer/`. Public browser replay is unchanged
in authority and still requires no key. The browser self-hosted route still
needs the operator's gateway/BFF.

## Migration and scope

See [boundary completion](M2_BOUNDARY_COMPLETION.md) for the exact HTTP,
artifact-budget, single-resource and storage contracts. Existing
Network/Terraform and historical review rows remain readable. Kubernetes
input hashes now bind raw artifacts; use the self-hosted proof boundary.
Old experimental decision bodies carrying operation/resource/object hashes
are rejected; send actor/optional actor UID/expiry preferences only.

Deploy routing guards before handing out workload credentials, keep the
enforcer's policy version aligned with the decision server, and preserve
both review and use-state databases. Only shared reliable local SQLite
locking is supported; cross-node HA and replay protection after a database
rollback/restore are unimplemented. Grants may be spent before a later API
server rejection; obtain a new review rather than resetting use-state.
CREATE/UPDATE support is limited to Deployment, StatefulSet, DaemonSet and
Service; protected Scale/HPA are denied and DELETE/other kinds are not covered.

## Release preparation and validation

`npm run build:cli`, `npm run build:packages` and
`tests/integration/publishable-packages.test.ts` validate packed library ESM,
types and the new grant exports outside the workspace. The committed CLI
bundle is rebuilt and checked by CI. `verify:authorization` runs separately
from offline tests and pins its checker hash.

Before an actual publication, the candidate commit must have green full CI,
Playwright, corpus, client-boundary and live admission jobs, and an explicit
owner publication action. The current authorization covers preparation;
no tag or published release is created here. Existing trusted publishing
must publish the five packages as a coherent set; do not bypass its collision
or provenance checks. Policy behavior/formula is unchanged, so policy
versions are not bumped merely for the package release.
