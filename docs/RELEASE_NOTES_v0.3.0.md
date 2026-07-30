# ChangeSafe v0.3.0

> **Packaging notice:** the first manual publication of
> `@changesafe/domain-kubernetes@0.3.0` contains extensionless ESM imports and
> cannot be imported directly by Node. Use `0.3.1` or later. The bundled
> `changesafe@0.3.0` CLI is unaffected.

All five public v0.3.0 packages were published manually from the tagged
commit. They do not carry npm provenance attestations.

## Kubernetes offline gate

- Added the publishable `@changesafe/domain-kubernetes` package.
- Added deterministic normalization, manifest upsert proposals, transactional rollback, simulation, and five Kubernetes safety policies.
- Added `changesafe gate --domain kubernetes` for JSON, YAML, and multi-document YAML manifests.
- Added the private, namespace-scoped read-only collector and `changesafe kubernetes collect`.
- Added least-privilege RBAC guidance and offline contract coverage.

`@changesafe/domain-kubernetes@0.3.0` is a new npm package name. npm cannot
configure a trusted publisher before the package exists, so this release was
bootstrapped manually.

## Boundary

The collector performs only explicit namespace `get/list` reads and writes a snapshot atomically. The gate never contacts Kubernetes and never applies manifests. A clean result remains `gate_only`; a human decides.
