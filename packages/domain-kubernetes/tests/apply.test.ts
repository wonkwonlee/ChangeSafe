import { describe, expect, it } from "vitest";

import { DomainError, type ChangeOperation } from "@changesafe/core";

import {
  applyKubernetesOperations,
  kubernetesDomain,
  parseKubernetesPath,
  resourceIdOf,
} from "../src/index";
import { normalizeSnapshot } from "../src/normalize";

const snapshot = normalizeSnapshot({
  snapshotVersion: "changesafe-kubernetes-snapshot/v1",
  snapshotId: "snapshot-apply",
  evidenceId: "ev-snapshot-apply",
  provenance: {
    source: "authored",
    collectedAtUtc: "2026-07-28T00:00:00.000Z",
    contextFingerprint: "context-apply",
    namespaces: ["demo"],
    serverVersion: null,
  },
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "web",
        namespace: "demo",
        annotations: { "annotation-note": "annotation-value" },
        labels: { app: "web", "label-note": "label-value" },
      },
      spec: {
        replicas: 2,
        template: {
          metadata: { labels: { "pod-label-note": "pod-label-value" } },
          spec: { containers: [{ name: "web", image: "registry.example/web:latest" }] },
        },
      },
    },
  ],
});

const original = snapshot.resources[0]!;
const path = `/resources/${original.resourceId}`;

function operation(
  op: "add" | "replace" | "remove",
  pathValue = path,
  value: ChangeOperation["value"] = { ...original, spec: { replicas: 3 } },
): ChangeOperation {
  return {
    op,
    path: pathValue,
    value,
    reason: "Exercise the Kubernetes transactional patch boundary.",
    evidenceIds: [original.evidenceId],
  };
}

describe("Kubernetes resource patch paths", () => {
  it("recognizes only complete resource-level paths", () => {
    // Removing this parser's resource-only restriction would make nested server fields patchable.
    expect(parseKubernetesPath(path)).toEqual({ resourceId: original.resourceId });
    expect(parseKubernetesPath(`${path}/spec/replicas`)).toBeNull();
    expect(parseKubernetesPath("/resources/not-a-kubernetes-id")).toBeNull();
  });
});

describe("applyKubernetesOperations", () => {
  it("replaces a complete resource without mutating the caller state", () => {
    const state = kubernetesDomain.stateOf(snapshot);
    const before = structuredClone(state);
    const result = applyKubernetesOperations(state, [operation("replace")]);

    expect(result.nextState.resources[original.resourceId]!.spec).toEqual({ replicas: 3 });
    expect(result.diff).toEqual([
      { op: "replace", path, before: original, after: { ...original, spec: { replicas: 3 } } },
    ]);
    expect(state).toEqual(before);
  });

  it("adds a complete resource and permits rollback removal", () => {
    const added = {
      ...original,
      identity: { ...original.identity, name: "worker" },
    };
    added.resourceId = resourceIdOf(added.identity);
    const addedPath = `/resources/${added.resourceId}`;
    const state = kubernetesDomain.stateOf(snapshot);

    const afterAdd = applyKubernetesOperations(state, [operation("add", addedPath, added)]);
    const afterRollback = applyKubernetesOperations(afterAdd.nextState, [
      operation("remove", addedPath, added),
    ]);

    expect(afterAdd.nextState.resources[added.resourceId]).toEqual(added);
    expect(afterRollback.nextState).toEqual(state);
  });

  it("rejects rollback removal whose complete value differs from the added resource", () => {
    const added = {
      ...original,
      identity: { ...original.identity, name: "worker" },
    };
    added.resourceId = resourceIdOf(added.identity);
    const addedPath = `/resources/${added.resourceId}`;
    const state = kubernetesDomain.stateOf(snapshot);
    const afterAdd = applyKubernetesOperations(state, [operation("add", addedPath, added)]);
    const beforeRemoval = structuredClone(afterAdd.nextState);
    const mismatchedInverse = {
      ...added,
      metadata: {
        ...added.metadata,
        labels: { ...added.metadata.labels, "label-note": "altered-value" },
      },
    };

    expect(() =>
      applyKubernetesOperations(afterAdd.nextState, [
        operation("remove", addedPath, mismatchedInverse),
      ]),
    ).toThrow(DomainError);
    expect(afterAdd.nextState).toEqual(beforeRemoval);
  });

  it.each([
    ["rejects a nested path", operation("replace", `${path}/spec/replicas`, 3)],
    ["rejects replacing a missing resource", operation("replace", "/resources/res-0123456789abcdef")],
    ["rejects duplicate add", operation("add")],
    ["rejects a value whose id does not equal the path", operation("replace", path, { ...original, resourceId: "res-0123456789abcdef" })],
    ["rejects a malformed complete resource", operation("replace", path, { resourceId: original.resourceId })],
  ])("%s", (_name, invalid) => {
    expect(() => applyKubernetesOperations(kubernetesDomain.stateOf(snapshot), [invalid])).toThrow(
      DomainError,
    );
  });

  it("discards all intermediate mutations when a later operation fails", () => {
    const state = kubernetesDomain.stateOf(snapshot);
    const before = structuredClone(state);

    expect(() =>
      applyKubernetesOperations(state, [
        operation("replace"),
        operation("replace", "/resources/res-0123456789abcdef"),
      ]),
    ).toThrow(DomainError);
    expect(state).toEqual(before);
  });

  it.each([
    ["an unknown operation", { ...operation("replace"), op: "move" }],
    [
      "an operation without op",
      {
        path,
        value: { ...original, spec: { replicas: 3 } },
        reason: "Exercise the Kubernetes transactional patch boundary.",
        evidenceIds: [original.evidenceId],
      },
    ],
    [
      "an operation without path",
      {
        op: "replace",
        value: { ...original, spec: { replicas: 3 } },
        reason: "Exercise the Kubernetes transactional patch boundary.",
        evidenceIds: [original.evidenceId],
      },
    ],
    [
      "an operation without value",
      {
        op: "replace",
        path,
        reason: "Exercise the Kubernetes transactional patch boundary.",
        evidenceIds: [original.evidenceId],
      },
    ],
    [
      "an operation without reason",
      {
        op: "replace",
        path,
        value: { ...original, spec: { replicas: 3 } },
        evidenceIds: [original.evidenceId],
      },
    ],
    [
      "an operation without evidence ids",
      {
        op: "replace",
        path,
        value: { ...original, spec: { replicas: 3 } },
        reason: "Exercise the Kubernetes transactional patch boundary.",
      },
    ],
    ["a non-object operation", null],
  ])("rejects %s before a transaction can escape", (_name, malformed) => {
    const state = kubernetesDomain.stateOf(snapshot);
    const before = structuredClone(state);

    expect(() => applyKubernetesOperations(state, [malformed])).toThrow(DomainError);
    expect(state).toEqual(before);
  });
});

describe("kubernetesDomain", () => {
  it("indexes cloned resources for state simulation", () => {
    const state = kubernetesDomain.stateOf(snapshot);

    expect(state).toEqual({ resources: { [original.resourceId]: original } });
    expect(state.resources).not.toBe(snapshot.resources);
    expect(state.resources[original.resourceId]).not.toBe(original);
  });

  it("provides resource-level policy context without widening the patch surface", () => {
    const texts = kubernetesDomain.untrustedTexts(snapshot).map((entry) => entry.text);

    expect(kubernetesDomain.policyVersion).toBe("core-v0.2.0+kubernetes-v0.1.0");
    expect(kubernetesDomain.blastRadiusUnit(operation("replace"))).toEqual({
      kind: "kubernetes-resource",
      id: original.resourceId,
    });
    expect(kubernetesDomain.blastRadiusUnit(operation("replace", "/resources/not-an-id"))).toBeNull();
    expect(kubernetesDomain.knownEvidenceIds(snapshot)).toEqual(
      new Set([snapshot.evidenceId, original.evidenceId]),
    );
    expect(texts).toContain(original.identity.name);
    expect(texts).toContain("annotation-note");
    expect(texts).toContain("annotation-value");
    expect(texts).toContain("label-note");
    expect(texts).toContain("label-value");
    expect(texts).toContain("pod-label-note");
    expect(texts).toContain("pod-label-value");
    expect(texts).toContain("registry.example/web:latest");
  });
});
