import { describe, expect, it } from "vitest";

import { canonicalize, verifyRollback, type ChangeOperation, type ChangeProposal } from "@changesafe/core";

import {
  kubernetesDomain,
  normalizeSnapshot,
  resourceIdOf,
  runKubernetesSimulation,
} from "../src/index";

const snapshot = normalizeSnapshot({
  snapshotVersion: "changesafe-kubernetes-snapshot/v1",
  snapshotId: "snapshot-simulation",
  evidenceId: "ev-snapshot-simulation",
  provenance: {
    source: "authored",
    collectedAtUtc: "2026-07-28T00:00:00.000Z",
    contextFingerprint: "context-simulation",
    namespaces: ["demo"],
    serverVersion: null,
  },
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: "demo", labels: { app: "web" } },
      spec: {
        replicas: 2,
        template: {
          metadata: { labels: { app: "web" } },
          spec: { containers: [{ name: "web", image: "registry.example.invalid/web:v1" }] },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "web", namespace: "demo", labels: { app: "web" } },
      spec: { selector: { app: "web" } },
    },
  ],
});

const deployment = snapshot.resources.find((resource) => resource.identity.kind === "Deployment")!;
const service = snapshot.resources.find((resource) => resource.identity.kind === "Service")!;

function proposal(spec: Record<string, unknown>): ChangeProposal {
  const value = { ...deployment, spec: { ...deployment.spec, ...spec } };
  const operation: ChangeOperation = {
    op: "replace",
    path: `/resources/${deployment.resourceId}`,
    value,
    reason: "Exercise the offline Kubernetes simulation boundary.",
    evidenceIds: [deployment.evidenceId],
  } as ChangeOperation;
  return {
    proposalId: "proposal-simulation",
    summary: "Simulate one Kubernetes resource replacement.",
    diagnosis: {
      likelyCause: "A manifest update needs offline validation.",
      confidence: 0,
      evidenceIds: [snapshot.evidenceId],
      assumptions: [],
    },
    operations: [operation],
    rollbackOperations: [{ ...operation, value: deployment }],
    verificationSteps: [],
  } as ChangeProposal;
}

function property(result: ReturnType<typeof runKubernetesSimulation>, propertyId: string) {
  const found = result.safetyProperties.find((candidate) => candidate.propertyId === propertyId);
  if (!found) throw new Error(`missing safety property ${propertyId}`);
  return found;
}

describe("runKubernetesSimulation", () => {
  it("applies a change only to a sandboxed copy with deterministic resource diffs", () => {
    const inputBefore = canonicalize(snapshot);
    const result = runKubernetesSimulation(snapshot, proposal({ replicas: 3 }));

    expect(result.changedResourceIds).toEqual([deployment.resourceId]);
    expect(result.diff).toEqual([
      {
        op: "replace",
        path: `/resources/${deployment.resourceId}`,
        before: deployment,
        after: { ...deployment, spec: { ...deployment.spec, replicas: 3 } },
      },
    ]);
    expect(canonicalize(snapshot)).toBe(inputBefore);
    expect(result.summary).toMatch(/No Kubernetes API was contacted and no manifest was applied\.$/);
  });

  it("reports all modeled safety properties for an affected resource", () => {
    const result = runKubernetesSimulation(snapshot, proposal({ replicas: 3 }));
    expect(result.safetyProperties.map((item) => item.propertyId)).toEqual([
      "k8s-no-zero-replica-workloads",
      "k8s-service-selectors-resolve",
      "k8s-no-new-privileged-workloads",
      "k8s-protected-resources-unchanged",
    ]);
    expect(result.safetyProperties.every((item) => item.satisfied)).toBe(true);
  });

  it("marks an orphaned Service selector as an unsatisfied safety property", () => {
    const result = runKubernetesSimulation(snapshot, proposal({ podLabels: { app: "other" } }));
    expect(property(result, "k8s-service-selectors-resolve")).toMatchObject({ satisfied: false });
  });

  it("marks a newly added orphaned Service selector as an unsatisfied safety property", () => {
    const identity = { ...service.identity, name: "api" };
    const addedService = {
      ...service,
      resourceId: resourceIdOf(identity),
      identity,
      spec: { ...service.spec, selector: { app: "api" } },
    };
    const change: ChangeProposal = {
      ...proposal({ replicas: 3 }),
      operations: [{
        op: "add",
        path: `/resources/${addedService.resourceId}`,
        value: addedService,
        reason: "Exercise a new Service selector in the offline simulation.",
        evidenceIds: [snapshot.evidenceId],
      }],
      rollbackOperations: [{
        op: "remove",
        path: `/resources/${addedService.resourceId}`,
        value: addedService,
        reason: "Remove the sandbox-only Service addition.",
        evidenceIds: [snapshot.evidenceId],
      }],
    } as ChangeProposal;

    const result = runKubernetesSimulation(snapshot, change);

    expect(property(result, "k8s-service-selectors-resolve")).toMatchObject({ satisfied: false });
  });

  it("marks a zero-replica workload as an unsatisfied safety property", () => {
    const result = runKubernetesSimulation(snapshot, proposal({ replicas: 0 }));
    expect(property(result, "k8s-no-zero-replica-workloads")).toMatchObject({ satisfied: false });
  });

  it("proves the mechanically captured rollback restores canonical state", () => {
    const change = proposal({ replicas: 3 });
    const original = kubernetesDomain.stateOf(snapshot);
    expect(
      verifyRollback(kubernetesDomain, original, change.operations, change.rollbackOperations),
    ).toEqual({ ok: true });
  });

  it("rejects an invalid public snapshot or a forward deletion before simulation", () => {
    const invalidSnapshot = {
      ...snapshot,
      resources: [{ ...deployment, status: { availableReplicas: 2 } }],
    };
    const deletion = {
      ...proposal({ replicas: 3 }),
      operations: [{ ...proposal({ replicas: 3 }).operations[0]!, op: "remove" }],
    };

    expect(() => runKubernetesSimulation(invalidSnapshot as never, proposal({ replicas: 3 }))).toThrow();
    expect(() => runKubernetesSimulation(snapshot, deletion as never)).toThrow();
  });
});
