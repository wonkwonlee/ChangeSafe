# ChangeSafe v0.3.1

This patch release republishes the v0.3 Kubernetes domain with valid
Node-resolvable ESM import specifiers.

`@changesafe/domain-kubernetes@0.3.0` was built from raw TypeScript output
during its first manual publication, so importing the package directly in
Node failed on extensionless relative imports. The CLI bundle was not
affected, but the library package was.

v0.3.1 adds the Kubernetes domain to the installed-tarball import smoke test,
bumps the workspace as one release set, and keeps all Kubernetes gate and
collector behavior unchanged.

Use `@changesafe/domain-kubernetes@0.3.1` or later. The broken `0.3.0`
library version is deprecated on npm.

The five public v0.3.1 packages were published manually from tag `v0.3.1`
(commit `da6dbfa6c23dda272cb1d1a9973111f8500d7e2a`) so the immutable broken
version could be remediated immediately. They do not carry npm provenance
attestations.
