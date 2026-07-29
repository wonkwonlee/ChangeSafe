# ChangeSafe v0.3.0

## Kubernetes offline gate

- Added the publishable `@changesafe/domain-kubernetes` package.
- Added deterministic normalization, manifest upsert proposals, transactional rollback, simulation, and five Kubernetes safety policies.
- Added `changesafe gate --domain kubernetes` for JSON, YAML, and multi-document YAML manifests.
- Added the private, namespace-scoped read-only collector and `changesafe kubernetes collect`.
- Added least-privilege RBAC guidance and offline contract coverage.

`@changesafe/domain-kubernetes@0.3.0` is a new npm package name. Its first
publication must be performed by an authenticated maintainer before the npm
trusted-publisher setting can be attached; unlike subsequent OIDC releases,
that initial package publication will not carry a provenance attestation.

## Boundary

The collector performs only explicit namespace `get/list` reads and writes a snapshot atomically. The gate never contacts Kubernetes and never applies manifests. A clean result remains `gate_only`; a human decides.
