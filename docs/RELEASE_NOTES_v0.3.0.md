# ChangeSafe v0.3.0

## Kubernetes offline gate

- Added the publishable `@changesafe/domain-kubernetes` package.
- Added deterministic normalization, manifest upsert proposals, transactional rollback, simulation, and five Kubernetes safety policies.
- Added `changesafe gate --domain kubernetes` for JSON, YAML, and multi-document YAML manifests.
- Added the private, namespace-scoped read-only collector and `changesafe kubernetes collect`.
- Added least-privilege RBAC guidance and offline contract coverage.

## Boundary

The collector performs only explicit namespace `get/list` reads and writes a snapshot atomically. The gate never contacts Kubernetes and never applies manifests. A clean result remains `gate_only`; a human decides.
