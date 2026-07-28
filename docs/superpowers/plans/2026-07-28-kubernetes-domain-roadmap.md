# Kubernetes Domain and Read-Only Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release ChangeSafe v0.3.0 with a deterministic Kubernetes simulated-state domain that gates proposed manifests against an offline snapshot, plus an explicitly scoped read-only cluster collector that creates the same snapshot format.

**Architecture:** `@changesafe/domain-kubernetes` is a published, pure domain package. It normalizes a stored snapshot and proposed YAML/JSON manifests, derives resource-level declarative operations, runs deterministic policies, applies changes transactionally to a deep clone, and simulates post-change safety properties. A separate internal `@changesafe/kubernetes-collector` package is the only component allowed to contact a Kubernetes API; it can perform only namespace-scoped `get/list` reads and writes a complete snapshot atomically. The collector never calls the gate internally, and the gate never contacts a cluster.

**Tech Stack:** Node.js 22, npm 10.9.8 workspaces, strict TypeScript, Zod 4, Vitest, `yaml`, official `@kubernetes/client-node`, existing `@changesafe/core` DomainAdapter and CLI.

## Global Constraints

- Base branch: current `main` at `0aefc0813c3e6a5137e2860d6152f1143fe05682`; functional baseline: `v0.2.0`.
- Target release: `v0.3.0`.
- ChangeSafe never creates, updates, patches, deletes, applies, execs into, or otherwise mutates a Kubernetes resource.
- Offline gating is the product path: `snapshot + proposed manifests -> normalize -> derive operations -> deterministic gate -> optional sandbox simulation -> receipt`.
- The collector is a separate acquisition boundary and may use only namespace-scoped `get/list` operations.
- A collection failure writes no snapshot. A parse, normalization, reference, policy, or simulation failure produces no successful verdict.
- Supported v1 kinds are exactly `apps/v1 Deployment`, `apps/v1 StatefulSet`, `apps/v1 DaemonSet`, and `v1 Service`.
- The v1 collector requires one or more explicit namespaces. Cluster-wide collection is not supported.
- `Secret`, live `Pod`, `ConfigMap`, RBAC objects, CRDs, custom resources, cluster-scoped resources, and manifest deletion intents are rejected as unsupported.
- Proposed manifests are an upsert set: an existing identity becomes `replace`; an absent identity becomes `add`. Omission never means deletion.
- Kubernetes status, `managedFields`, UIDs, resource versions, generations, timestamps, and server-assigned fields never enter the simulated state.
- Policies are pure functions, receive no model confidence, and never import the AI or collector packages.
- Any `BLOCK` remains unapprovable. The CLI emits only `blocked` or `gate_only`.
- Risk derivation remains core-owned: any BLOCK -> CRITICAL, at least two WARN -> HIGH, one WARN -> MEDIUM, otherwise LOW.
- All bundled examples use fictional names and contain no credentials, tokens, certificates, private registry URLs, or real cluster identifiers.
- Node 22 and npm 10.9.8 remain exact release constraints. Installation and CI use the existing immutable lockfile workflow.

## Release Boundary

### Included in v0.3.0

1. Published `@changesafe/domain-kubernetes`.
2. CLI support for `changesafe gate --domain kubernetes --input snapshot.json --proposal manifests.yaml`.
3. CLI support for JSON, YAML, and multi-document YAML proposal manifests.
4. Namespace-scoped `changesafe kubernetes collect` using the current kubeconfig or an explicit kubeconfig/context.
5. Deterministic policy findings for privilege escalation, workload availability, Service selector integrity, protected resources, and mutable images.
6. Transactional sandbox simulation and rollback proof for add/replace operations.
7. Safe, blocked, and adversarial fixtures plus an opt-in `kind` integration test.
8. Kubernetes quickstart, least-privilege RBAC example, threat-model update, and release notes.

### Explicitly deferred beyond v0.3.0

- Applying manifests, server-side dry-run, `kubectl diff`, admission webhooks, operators, controllers, and continuous watches.
- Delete operations, pruning, Helm rendering, Kustomize rendering, and GitOps-controller integration.
- Cluster-wide collection and cluster-scoped resources.
- Pods, Jobs, CronJobs, Ingress, NetworkPolicy, ConfigMap, Secret, PVC, PV, RBAC, CRDs, and custom resources.
- Web-console Kubernetes workflows and model-authored Kubernetes proposals.
- A Kubernetes policy DSL or direct reuse of Rego, Kyverno, or Gatekeeper policies.

## Data Contracts

The package exports these stable interfaces:

```ts
export type KubernetesKind = "Deployment" | "StatefulSet" | "DaemonSet" | "Service";

export interface KubernetesIdentity {
  apiVersion: "apps/v1" | "v1";
  kind: KubernetesKind;
  namespace: string;
  name: string;
}

export interface KubernetesSnapshot {
  snapshotVersion: "changesafe-kubernetes-snapshot/v1";
  snapshotId: string;
  evidenceId: string;
  provenance: {
    source: "cluster-api" | "authored";
    collectedAtUtc: string;
    contextFingerprint: string;
    namespaces: string[];
    serverVersion: string | null;
  };
  resources: KubernetesResource[];
}

export interface KubernetesState {
  resources: Record<string, KubernetesResource>;
}

export interface KubernetesManifestSet {
  documents: unknown[];
}

export interface DerivedKubernetesProposal {
  proposal: KubernetesChangeProposal;
  resourceEvidenceIds: string[];
}

export function normalizeSnapshot(raw: unknown): KubernetesSnapshot;
export function parseManifestDocuments(raw: string): KubernetesManifestSet;
export function deriveManifestProposal(
  snapshot: KubernetesSnapshot,
  manifests: KubernetesManifestSet,
): DerivedKubernetesProposal;
export function runKubernetesSimulation(
  snapshot: KubernetesSnapshot,
  proposal: KubernetesChangeProposal,
): SimulationResult;
```

Each normalized resource receives a stable `resourceId` computed from the canonical identity using pure FNV-1a 64-bit encoding:

```ts
resourceIdOf({
  apiVersion: "apps/v1",
  kind: "Deployment",
  namespace: "demo",
  name: "web",
}) === "res-4372358bb3ca4163";
```

The FNV input is the UTF-8 encoding of `apiVersion + "\0" + kind + "\0" + namespace + "\0" + name`. Normalization must detect and reject a hash collision rather than allowing two identities to share an id. Operation paths are resource-level and therefore compatible with core's current state-path schema:

```text
/resources/res-4372358bb3ca4163
```

For v0.3.0, each operation adds or replaces one complete normalized resource. Rollback removes a newly added resource or replaces an existing resource with its complete captured value.

## Policy Contract

Evaluation order remains structural -> domain -> universal. Kubernetes domain policies run in this exact order:

1. `K8S_PRIVILEGE_ESCALATION`
   - BLOCK when a proposed workload newly enables `privileged`, `hostNetwork`, `hostPID`, `hostIPC`, `hostPath`, `allowPrivilegeEscalation: true`, `runAsUser: 0`, or a capability outside the Kubernetes Baseline allowlist.
   - PASS when none of those capabilities is newly introduced.
2. `K8S_WORKLOAD_AVAILABILITY`
   - BLOCK when an existing Deployment or StatefulSet is changed from replicas greater than zero to zero.
   - BLOCK when an existing Deployment changes strategy from `RollingUpdate` to `Recreate`.
   - WARN when replicas are reduced, or Deployment `maxUnavailable` increases, without reaching a BLOCK condition.
   - PASS for DaemonSets and changes that do not reduce modeled availability.
3. `K8S_SERVICE_SELECTOR`
   - BLOCK when a selector-bearing Service matches at least one supported workload before the change and none after the simulated change.
   - PASS for selectorless Services, `ExternalName` Services, or Services retaining at least one match.
4. `K8S_PROTECTED_RESOURCE`
   - BLOCK when an existing resource annotated `changesafe.dev/protected: "true"` is replaced with a different normalized spec or loses the annotation.
   - PASS otherwise.
5. `K8S_MUTABLE_IMAGE`
   - WARN when a proposed workload introduces an untagged image or a `:latest` tag.
   - PASS for digest-pinned or non-`latest` tagged images.

Universal policies remain active without exception:

```text
PATCH_SCHEMA
K8S_PRIVILEGE_ESCALATION
K8S_WORKLOAD_AVAILABILITY
K8S_SERVICE_SELECTOR
K8S_PROTECTED_RESOURCE
K8S_MUTABLE_IMAGE
BLAST_RADIUS
ROLLBACK_COMPLETE
VERIFICATION_REQUIRED
UNTRUSTED_INSTRUCTION
```

`ROLLBACK_COMPLETE` is applicable because the snapshot holds the complete normalized prior value and all forward changes occur on a clone.

---

### Task 1: Package Skeleton and Contract Tests

**Files:**
- Create: `packages/domain-kubernetes/package.json`
- Create: `packages/domain-kubernetes/tsconfig.build.json`
- Create: `packages/domain-kubernetes/src/index.ts`
- Create: `packages/domain-kubernetes/src/schemas.ts`
- Create: `packages/domain-kubernetes/tests/schemas.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `IdSchema`, `EvidenceIdSchema`, `TimestampSchema`, `makeProposalSchemas`, and `DomainAdapter` from `@changesafe/core`.
- Produces: the data contracts listed under “Data Contracts,” `KubernetesResourceSchema`, `KubernetesSnapshotSchema`, and `KubernetesChangeProposalSchema`.

- [ ] **Step 1: Write schema tests for accepted and rejected boundaries**

Add tests proving:

```ts
expect(KubernetesSnapshotSchema.parse(validSnapshot).resources).toHaveLength(4);
expect(() => KubernetesSnapshotSchema.parse(snapshotContainingSecret)).toThrow();
expect(() => KubernetesSnapshotSchema.parse(snapshotWithStatus)).toThrow();
expect(() => KubernetesSnapshotSchema.parse(snapshotWithDuplicateIdentity)).toThrow();
expect(() => KubernetesSnapshotSchema.parse(snapshotWithDuplicateResourceId)).toThrow();
```

- [ ] **Step 2: Run the focused test and verify the package is unresolved**

Run: `npx vitest run packages/domain-kubernetes/tests/schemas.test.ts`

Expected: FAIL because `@changesafe/domain-kubernetes` and its schemas do not exist.

- [ ] **Step 3: Add the published workspace package and strict Zod schemas**

Use the published-package shape of `packages/domain-terraform`. Keep the unreleased workspace at version `0.2.0` with dependency `@changesafe/core: ^0.2.0` during implementation; Task 9 performs the coordinated v0.3.0 release bump. Use `zod: ^4.4.3` and `yaml` at the exact version selected by `npm install`. Normalize only policy-relevant metadata and specs; unknown top-level Kubernetes fields are rejected after the kind-specific projection.

- [ ] **Step 4: Wire all repository resolvers**

Add `@changesafe/domain-kubernetes` to root TypeScript paths and Vitest aliases, append it after Terraform in `build:packages`, and run `npm install` once to update `package-lock.json`.

- [ ] **Step 5: Prove schema, type, and package build**

Run:

```bash
npx vitest run packages/domain-kubernetes/tests/schemas.test.ts
npx tsc --noEmit
npm run build -w @changesafe/domain-kubernetes
```

Expected: all commands exit 0 and `packages/domain-kubernetes/dist/index.d.ts` exists.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts packages/domain-kubernetes
git commit -m "feat(kubernetes): define snapshot and manifest contracts"
```

### Task 2: Deterministic Normalization and Manifest-Derived Proposals

**Files:**
- Create: `packages/domain-kubernetes/src/identity.ts`
- Create: `packages/domain-kubernetes/src/normalize.ts`
- Create: `packages/domain-kubernetes/src/manifests.ts`
- Create: `packages/domain-kubernetes/tests/fixtures/current.snapshot.json`
- Create: `packages/domain-kubernetes/tests/fixtures/safe-update.yaml`
- Create: `packages/domain-kubernetes/tests/fixtures/unsupported-secret.yaml`
- Create: `packages/domain-kubernetes/tests/normalize.test.ts`
- Modify: `packages/domain-kubernetes/src/index.ts`

**Interfaces:**
- Consumes: raw collector snapshots and raw manifest text.
- Produces: `resourceIdOf(identity)`, `normalizeSnapshot(raw)`, `parseManifestDocuments(text)`, and `deriveManifestProposal(snapshot, manifestSet)`.

- [ ] **Step 1: Write canonical identity and normalization tests**

The test suite must prove input-order independence, default normalization, removal of server-owned fields, stable ids, and collision rejection:

```ts
expect(canonicalize(normalizeSnapshot(snapshotA))).toBe(
  canonicalize(normalizeSnapshot(snapshotWithResourcesReordered)),
);
expect(resourceIdOf(identity)).toBe(resourceIdOf({ ...identity }));
expect(normalized.resources[0]).not.toHaveProperty("status");
expect(normalized.resources[0]).not.toHaveProperty("metadata.uid");
```

- [ ] **Step 2: Write manifest proposal tests**

Prove that an existing Deployment becomes one `replace`, a new Service becomes one `add`, omitted resources create no operation, duplicate identities reject, unsupported kinds reject, and rollback values exactly restore the prior state.

- [ ] **Step 3: Run tests and verify they fail**

Run: `npx vitest run packages/domain-kubernetes/tests/normalize.test.ts`

Expected: FAIL because normalization and proposal derivation are not defined.

- [ ] **Step 4: Implement pure identity, projection, sorting, and derivation**

`deriveManifestProposal` must produce a deterministic proposal with:

```ts
const existingResourceEvidenceIds = operations
  .filter((operation) => operation.op === "replace")
  .flatMap((operation) => operation.evidenceIds);

{
  proposalId: `kubernetes-${snapshot.snapshotId}`,
  summary: "Gate proposed Kubernetes manifest upserts against the captured snapshot.",
  diagnosis: {
    likelyCause: "Declarative Kubernetes manifests were supplied for deterministic review.",
    confidence: 0,
    evidenceIds: [snapshot.evidenceId],
    assumptions: ["Manifest omission does not request resource deletion."],
  },
  operations,
  rollbackOperations: inverseOperations,
  verificationSteps: [
    {
      kind: "precondition",
      description: "Confirm the captured snapshot still represents the reviewed namespaces.",
      evidenceIds: existingResourceEvidenceIds.length > 0
        ? existingResourceEvidenceIds
        : [snapshot.evidenceId],
    },
    {
      kind: "postcheck",
      description: "Confirm workload availability and Service selector matches after human execution.",
      evidenceIds: [snapshot.evidenceId],
    },
  ],
}
```

Every snapshot has a top-level evidence id, so an empty namespace snapshot can still ground the assertion that a proposed identity was absent when captured. Existing-resource operations cite that resource's evidence id; new-resource operations cite the snapshot evidence id. No clock, randomness, API call, or model call is permitted.

- [ ] **Step 5: Prove deterministic output**

Run:

```bash
npx vitest run packages/domain-kubernetes/tests/normalize.test.ts
npx tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/domain-kubernetes
git commit -m "feat(kubernetes): normalize manifests into deterministic proposals"
```

### Task 3: Transactional Patch Engine and Domain Adapter

**Files:**
- Create: `packages/domain-kubernetes/src/paths.ts`
- Create: `packages/domain-kubernetes/src/apply.ts`
- Create: `packages/domain-kubernetes/src/adapter.ts`
- Create: `packages/domain-kubernetes/tests/apply.test.ts`
- Modify: `packages/domain-kubernetes/src/index.ts`

**Interfaces:**
- Consumes: `KubernetesState` and core `ChangeOperation[]`.
- Produces: `parseKubernetesPath`, `applyKubernetesOperations`, `kubernetesDomain`, and policy version `core-v0.1.0+kubernetes-v0.1.0`.

- [ ] **Step 1: Write patch allowlist and transaction tests**

Cover add, replace, missing targets, duplicate adds, invalid values, forbidden nested paths, resource-id/value identity mismatch, multi-operation rollback on the first failure, and input immutability.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run packages/domain-kubernetes/tests/apply.test.ts`

Expected: FAIL because the patch engine is missing.

- [ ] **Step 3: Implement resource-level allowlisting**

Only these shapes are valid:

```text
add     /resources/{resourceId}  value: complete KubernetesResource
replace /resources/{resourceId}  value: complete KubernetesResource
```

`remove` is accepted only in generated rollback operations for a resource added by the forward proposal. The public manifest derivation path never creates a forward `remove`.

- [ ] **Step 4: Implement the pure DomainAdapter**

The adapter must:

```ts
stateOf(snapshot) => ({ resources: indexByResourceId(snapshot.resources) })
blastRadiusUnit(operation) => ({ kind: "kubernetes-resource", id: resourceId })
knownEvidenceIds(snapshot) => Set([snapshot.evidenceId, ...snapshot.resources.map(resource => resource.evidenceId)])
untrustedTexts(snapshot) => resource names, annotations, labels, and container image strings
```

The adapter imports no Node I/O, AI, CLI, or collector module.

- [ ] **Step 5: Run focused and core compatibility tests**

Run:

```bash
npx vitest run packages/domain-kubernetes/tests/apply.test.ts
npx vitest run packages/core/tests/standalone-domain.test.ts
npx tsc --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/domain-kubernetes
git commit -m "feat(kubernetes): add transactional simulated-state adapter"
```

### Task 4: Kubernetes Policy Set

**Files:**
- Create: `packages/domain-kubernetes/src/policies/privilege-escalation.ts`
- Create: `packages/domain-kubernetes/src/policies/workload-availability.ts`
- Create: `packages/domain-kubernetes/src/policies/service-selector.ts`
- Create: `packages/domain-kubernetes/src/policies/protected-resource.ts`
- Create: `packages/domain-kubernetes/src/policies/mutable-image.ts`
- Create: `packages/domain-kubernetes/tests/policies.test.ts`
- Modify: `packages/domain-kubernetes/src/adapter.ts`
- Modify: `packages/domain-kubernetes/src/index.ts`

**Interfaces:**
- Consumes: `PolicyContext<KubernetesSnapshot, KubernetesState>`.
- Produces: five policy evaluators with the exact ids and verdict rules in “Policy Contract.”

- [ ] **Step 1: Write one PASS and every WARN/BLOCK case per policy**

Use table-driven tests and assert full `PolicyFinding` fields, not only status:

```ts
expect(finding).toMatchObject({
  policyId: "K8S_PRIVILEGE_ESCALATION",
  status: "BLOCK",
  affectedResources: ["/resources/res-..."],
});
expect(finding.remediation).toContain("privileged");
```

- [ ] **Step 2: Prove fail-closed behavior**

Add cases where a malformed forward operation makes policies unable to construct post-change state. The policy must return BLOCK rather than PASS or throw an untyped exception.

- [ ] **Step 3: Run tests and verify failure**

Run: `npx vitest run packages/domain-kubernetes/tests/policies.test.ts`

Expected: FAIL because the policy evaluators are absent.

- [ ] **Step 4: Implement the five pure evaluators**

Derive before/after resources only through `adapter.applyOperations`. Base privilege checks on the Kubernetes Pod Security Standards fields enumerated in this plan. Treat unsupported or ambiguous security values as BLOCK, not as safe defaults.

- [ ] **Step 5: Assert published order and risk parity**

Add a test expecting the exact policy order and a mixed two-WARN proposal to derive `HIGH` through core. No Kubernetes module may calculate risk.

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run packages/domain-kubernetes/tests/policies.test.ts
npx vitest run tests/unit/policies.test.ts
npx tsc --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/domain-kubernetes
git commit -m "feat(kubernetes): add deterministic safety policies"
```

### Task 5: Sandboxed Kubernetes Simulation

**Files:**
- Create: `packages/domain-kubernetes/src/simulate.ts`
- Create: `packages/domain-kubernetes/tests/simulate.test.ts`
- Modify: `packages/domain-kubernetes/src/index.ts`

**Interfaces:**
- Consumes: a validated `KubernetesSnapshot` and `KubernetesChangeProposal`.
- Produces: `runKubernetesSimulation(snapshot, proposal): SimulationResult`.

- [ ] **Step 1: Write simulation tests**

Prove changed resource ids, deterministic diffs, input immutability, Service selector satisfaction, workload replica satisfaction, and failed safety properties for orphaned Services or zero-replica workloads.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run packages/domain-kubernetes/tests/simulate.test.ts`

Expected: FAIL because the simulator is absent.

- [ ] **Step 3: Implement safety property evaluation**

Every run returns these modeled properties for affected resources:

```text
k8s-no-zero-replica-workloads
k8s-service-selectors-resolve
k8s-no-new-privileged-workloads
k8s-protected-resources-unchanged
```

The summary must end with: `No Kubernetes API was contacted and no manifest was applied.`

- [ ] **Step 4: Prove rollback through core**

Add a test calling `verifyRollback(kubernetesDomain, originalState, forward, rollback)` and assert `{ ok: true }` plus canonical equality with the original.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run packages/domain-kubernetes/tests/simulate.test.ts
npx vitest run packages/domain-kubernetes
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/domain-kubernetes
git commit -m "feat(kubernetes): simulate manifest changes on cloned state"
```

### Task 6: CLI Offline Manifest/Snapshot Gate

**Files:**
- Create: `packages/cli/src/kubernetes-manifests.ts`
- Create: `packages/cli/tests/fixtures/kubernetes/current.snapshot.json`
- Create: `packages/cli/tests/fixtures/kubernetes/safe-update.yaml`
- Create: `packages/cli/tests/fixtures/kubernetes/privileged-update.yaml`
- Modify: `packages/cli/src/domains.ts`
- Modify: `packages/cli/src/gate.ts`
- Modify: `packages/cli/src/verify.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/tests/cli.test.ts`

**Interfaces:**
- Consumes: snapshot JSON and YAML/JSON manifest documents.
- Produces: Kubernetes entry in `DOMAIN_IDS` and the command:

```bash
changesafe gate \
  --domain kubernetes \
  --input current.snapshot.json \
  --proposal proposed.yaml \
  --receipt receipt.json \
  --format json
```

- [ ] **Step 1: Extend the CLI-domain proposal hook in tests**

Change the contract to:

```ts
parseProposal(raw: unknown, input: unknown): {
  proposal: unknown;
  provenance: string | null;
  fixtureId: string | null;
};
readProposalFile?(filePath: string): unknown;
```

Network and Terraform behavior must remain byte-for-byte unchanged.

- [ ] **Step 2: Add CLI end-to-end tests**

Assert:

```text
safe-update.yaml -> exit 0, decision gate_only, domain kubernetes
privileged-update.yaml -> exit 1, K8S_PRIVILEGE_ESCALATION BLOCK
unsupported-secret.yaml -> exit 2, no receipt
missing snapshot -> exit 2
malformed YAML -> exit 2
verify with --domain kubernetes and the same snapshot/manifests -> hashes match
```

- [ ] **Step 3: Run the focused CLI tests and verify failure**

Run: `npx vitest run packages/cli/tests/cli.test.ts -t kubernetes`

Expected: FAIL because the Kubernetes domain is not registered.

- [ ] **Step 4: Register YAML loading and Kubernetes proposal derivation**

YAML parsing occurs before the pure gate boundary. The registered domain passes structured documents plus the parsed snapshot to `deriveManifestProposal`; `gateParsedProposal` remains the single gate path for network, Terraform, and Kubernetes. `runVerify` must parse the input first and pass that parsed input to the same `parseProposal(raw, input)` hook, so verification hashes the identical derived proposal rather than raw YAML.

- [ ] **Step 5: Build and run the real bundled binary**

Run:

```bash
npm run build:cli
node packages/cli/dist/changesafe.js gate --domain kubernetes \
  --input packages/cli/tests/fixtures/kubernetes/current.snapshot.json \
  --proposal packages/cli/tests/fixtures/kubernetes/safe-update.yaml \
  --format json
```

Expected: exit 0 with `decision: "gate_only"` and no network access.

- [ ] **Step 6: Commit**

```bash
git add packages/cli package.json package-lock.json
git commit -m "feat(cli): gate Kubernetes manifests against offline snapshots"
```

### Task 7: Read-Only Kubernetes Collector

**Files:**
- Create: `packages/kubernetes-collector/package.json`
- Create: `packages/kubernetes-collector/src/types.ts`
- Create: `packages/kubernetes-collector/src/client.ts`
- Create: `packages/kubernetes-collector/src/collect.ts`
- Create: `packages/kubernetes-collector/src/index.ts`
- Create: `packages/kubernetes-collector/tests/collect.test.ts`
- Create: `packages/cli/src/kubernetes-collect.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/tests/cli.test.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: kubeconfig path/context, explicit namespace array, an injected read-only client, and an injected clock.
- Produces:

```ts
export interface ReadOnlyKubernetesClient {
  serverVersion(): Promise<string>;
  listDeployments(namespace: string): Promise<unknown[]>;
  listStatefulSets(namespace: string): Promise<unknown[]>;
  listDaemonSets(namespace: string): Promise<unknown[]>;
  listServices(namespace: string): Promise<unknown[]>;
}

export async function collectKubernetesSnapshot(
  options: {
    namespaces: string[];
    contextFingerprint: string;
    now: () => string;
    maxResources: number;
  },
  client: ReadOnlyKubernetesClient,
): Promise<KubernetesSnapshot>;
```

CLI:

```bash
changesafe kubernetes collect \
  --namespace demo \
  --namespace payments \
  --context staging-readonly \
  --out current.snapshot.json
```

- [ ] **Step 1: Write transport-isolated collector tests**

Use a fake client with only the five methods above. Prove deterministic ordering, namespace deduplication, a 2,000-resource hard cap, context fingerprinting, no Secret/Pod method, rejection of kubeconfig `exec` and `auth-provider` credential plugins, and no partial snapshot on any rejected list call.

- [ ] **Step 2: Add a static capability test**

Scan production collector source and fail if it contains Kubernetes mutation or remote-command method names:

```ts
expect(source).not.toMatch(
  /\.(create|replace|patch|delete|deleteCollection|connect|exec|portForward|watch)[A-Z]/,
);
```

Also assert no `node:child_process` import and no `kubectl` invocation.

- [ ] **Step 3: Run tests and verify failure**

Run: `npx vitest run packages/kubernetes-collector/tests/collect.test.ts`

Expected: FAIL because the collector does not exist.

- [ ] **Step 4: Add the internal collector workspace**

Keep `"private": true`; the public contract in v0.3.0 is the `changesafe kubernetes collect` command, not a second npm library. Add `@kubernetes/client-node` as the collector's dependency and expose only the narrow read-only wrapper to the rest of the repository.

- [ ] **Step 5: Implement safe kubeconfig and collection behavior**

Requirements:

```text
--namespace is mandatory and repeatable
--all-namespaces is not accepted
--out is mandatory
default kubeconfig loading is allowed
--kubeconfig and --context are optional explicit selectors
kubeconfig is parsed and rejected before client construction when the selected user contains exec or auth-provider credentials
token, tokenFile, client certificate, and client key authentication are accepted
list calls run sequentially
API errors collapse to status/reason without response bodies or credentials
output is written to a sibling temporary file, fsynced, then renamed
temporary output is removed on failure
```

The context fingerprint is SHA-256 over the API server origin plus context name; the raw server URL and context name are not stored. Rejecting credential plugins is required because they can spawn external commands, which would violate ChangeSafe's no-execution invariant even if every Kubernetes API call were read-only.

- [ ] **Step 6: Add CLI tests**

Inject the fake client factory and verify exit 0 for a complete snapshot, exit 2 for 401/403/timeout, refusal of a missing namespace, and preservation of a pre-existing output file when collection fails.

- [ ] **Step 7: Run focused verification**

Run:

```bash
npx vitest run packages/kubernetes-collector/tests/collect.test.ts
npx vitest run packages/cli/tests/cli.test.ts -t "kubernetes collect"
npx tsc --noEmit
npm run build:cli
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/kubernetes-collector packages/cli tsconfig.json vitest.config.ts package-lock.json
git commit -m "feat(kubernetes): add namespace-scoped read-only collector"
```

### Task 8: Scenario Corpus and Optional Real-Cluster Contract

**Files:**
- Create: `packages/domain-kubernetes/tests/fixtures/availability-regression.yaml`
- Create: `packages/domain-kubernetes/tests/fixtures/orphaned-service.yaml`
- Create: `packages/domain-kubernetes/tests/fixtures/protected-workload.yaml`
- Create: `packages/domain-kubernetes/tests/fixtures/mutable-image.yaml`
- Create: `tests/integration/kubernetes-contracts.test.ts`
- Create: `tests/integration/kubernetes-kind.test.ts`
- Create: `scripts/kind/readonly-rbac.yaml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: static fixtures by default; a locally available `kind` cluster only when `CHANGESAFE_K8S_LIVE_TEST=1`.
- Produces: deterministic fixture coverage plus a non-default live collector parity check.

- [ ] **Step 1: Add the offline domain contract matrix**

Assert the complete expected policy status, risk, decision, and receipt hashes for safe, privilege, availability, selector, protected, and mutable-image fixtures.

- [ ] **Step 2: Add collector-to-offline parity test**

With an injected collector client, produce a snapshot, save/load it, and prove the gate result equals the result from the equivalent authored snapshot.

- [ ] **Step 3: Add an opt-in `kind` test**

The test must skip unless `CHANGESAFE_K8S_LIVE_TEST=1`. It creates no resources itself. It assumes the operator provisioned the fictional fixture namespace and read-only ServiceAccount, runs only collection, and compares the normalized snapshot to the committed expected artifact.

- [ ] **Step 4: Add a CI static safety job**

Default CI runs the offline matrix and source capability scan. It does not start a cluster and needs no Kubernetes credentials.

- [ ] **Step 5: Run integration verification**

Run:

```bash
npx vitest run tests/integration/kubernetes-contracts.test.ts
npx vitest run tests/integration/kubernetes-kind.test.ts
```

Expected: offline tests pass; the live test reports skipped when the environment variable is absent.

- [ ] **Step 6: Commit**

```bash
git add packages/domain-kubernetes/tests tests/integration scripts/kind .github/workflows/ci.yml
git commit -m "test(kubernetes): lock offline and read-only collector contracts"
```

### Task 9: Documentation, Security Review, and v0.3.0 Release Gate

**Files:**
- Create: `docs/KUBERNETES.md`
- Create: `examples/kubernetes/changesafe-reader.yaml`
- Create: `docs/RELEASE_NOTES_v0.3.0.md`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/OSS_ROADMAP.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/cli/src/version.ts`
- Modify: package versions under `packages/core`, `packages/domain-*`, and `packages/cli`

**Interfaces:**
- Consumes: completed domain, CLI, collector, tests, and least-privilege RBAC.
- Produces: auditable user guidance and the v0.3.0 release candidate.

- [ ] **Step 1: Document the two-stage trust boundary**

`docs/KUBERNETES.md` must show:

```text
Kubernetes API --GET/LIST--> collector --atomic JSON--> snapshot
snapshot + manifests --> pure domain --> findings/receipt
```

State explicitly that a clean gate is not approval and that ChangeSafe cannot apply the reviewed manifests.

- [ ] **Step 2: Add least-privilege namespace RBAC**

The example uses a namespaced `Role` and `RoleBinding` with exactly:

```yaml
apiGroups: ["apps"]
resources: ["deployments", "statefulsets", "daemonsets"]
verbs: ["get", "list"]
---
apiGroups: [""]
resources: ["services"]
verbs: ["get", "list"]
```

It grants no `watch`, no write verb, no Secrets, and no cluster-wide binding.

- [ ] **Step 3: Update threat model and architecture**

Cover compromised kubeconfig, over-broad user RBAC, malicious object metadata, API response size exhaustion, stale snapshot/time-of-check-time-of-use, collector dependency compromise, context confusion, and snapshot tampering. Mitigations must point to concrete tests or code boundaries.

- [ ] **Step 4: Run the invariant review**

Run:

```bash
rg '@changesafe/ai' packages/core/src packages/domain-*/src
rg 'node:child_process|kubectl' packages/*/src
rg '\\.(create|replace|patch|delete|deleteCollection|connect|exec|portForward|watch)[A-Z]' packages/kubernetes-collector/src
rg '\\.confidence' packages/core/src/policies packages/domain-*/src/policies
rg 'exec:|auth-provider:' packages/kubernetes-collector/tests/fixtures
```

Expected: no prohibited import or action path. Any detector string must be explained by its test.

- [ ] **Step 5: Run the complete release gate**

Run in this exact order:

```bash
npm ci
npm run lint
npm run typecheck
npm run build:packages
npm run build:cli
npm test
npm run build
npm run test:e2e
```

Expected: every command exits 0 on Node 22 with npm 10.9.8.

- [ ] **Step 6: Inspect packaged artifacts**

Run `npm pack --dry-run` for core, all three domain packages, and CLI. Confirm source fixtures, kubeconfig data, credentials, and collector test artifacts are absent. Run the built CLI from a temporary directory against the offline Kubernetes fixtures.

- [ ] **Step 7: Commit**

```bash
git add README.md docs examples packages package.json package-lock.json
git commit -m "docs(kubernetes): prepare the v0.3.0 release"
```

## Milestones and Exit Gates

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| K0 — Contract | Schemas, normalized identities, fixtures | Unsupported kinds and server-owned fields fail closed |
| K1 — Offline domain | Manifest derivation, adapter, policies, simulation | Safe case gates; adversarial cases block; rollback restores canonical state |
| K2 — CLI | `--domain kubernetes` over snapshot + YAML/JSON | Bundled CLI works with no network and produces verifiable receipts |
| K3 — Collector | Namespace-scoped `get/list` snapshot acquisition | Static capability scan clean; partial writes impossible; 401/403/timeouts exit 2 |
| K4 — Release | Docs, RBAC, threat model, full CI | Complete repository gate green on Node 22/npm 10.9.8 |

## Owner Checkpoints

Implementation pauses for Raymond's review at these points:

1. After K0: inspect the normalized resource model and confirm the supported-kind boundary.
2. After K1: inspect the policy verdict matrix and decide whether each WARN/BLOCK severity matches ChangeSafe's product posture.
3. Before K3 touches a real cluster: review the exact RBAC Role and run the collector first against a disposable `kind` namespace.
4. Before v0.3.0 publication: review package contents, README claims, release notes, and npm version changes.

## Acceptance Commands

The first complete user journey is:

```bash
changesafe kubernetes collect \
  --namespace demo \
  --context demo-readonly \
  --out current.snapshot.json

changesafe gate \
  --domain kubernetes \
  --input current.snapshot.json \
  --proposal proposed.yaml \
  --receipt kubernetes-receipt.json

changesafe verify kubernetes-receipt.json \
  --domain kubernetes \
  --input current.snapshot.json \
  --proposal proposed.yaml
```

The first command is the only networked step and is read-only. The second and third commands must succeed with Kubernetes unavailable. None of the three commands can execute the proposed change.

## Primary References

- Kubernetes RBAC authorization: <https://kubernetes.io/docs/reference/access-authn-authz/rbac/>
- Kubernetes Pod Security Standards: <https://kubernetes.io/docs/concepts/security/pod-security-standards/>
- Kubernetes Deployment rolling-update semantics: <https://kubernetes.io/docs/concepts/workloads/controllers/deployment/>
- Official JavaScript Kubernetes client: <https://github.com/kubernetes-client/javascript>
