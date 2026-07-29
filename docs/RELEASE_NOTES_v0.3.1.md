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
