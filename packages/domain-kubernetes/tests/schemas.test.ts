import { describe, expect, it } from "vitest";
import {
  KubernetesChangeProposalSchema,
  KubernetesReplayFixtureSchema,
  KubernetesSnapshotSchema,
} from "@changesafe/domain-kubernetes";
import type { KubernetesDomainAdapter } from "@changesafe/domain-kubernetes";

const requireKubernetesAdapter = (adapter: KubernetesDomainAdapter) => adapter;
void requireKubernetesAdapter;

const validSnapshot = {
  snapshotVersion: "changesafe-kubernetes-snapshot/v1",
  snapshotId: "snapshot-demo",
  evidenceId: "ev-snapshot-demo",
  provenance: {
    source: "authored",
    collectedAtUtc: "2026-07-28T00:00:00.000Z",
    contextFingerprint: "context-demo",
    namespaces: ["demo"],
    serverVersion: "v1.31.0",
  },
  resources: [
    {
      resourceId: "res-0000000000000001",
      evidenceId: "ev-deployment-web",
      identity: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        namespace: "demo",
        name: "web",
      },
      metadata: { annotations: {}, labels: { app: "web" } },
      spec: {},
    },
    {
      resourceId: "res-0000000000000002",
      evidenceId: "ev-statefulset-db",
      identity: {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        namespace: "demo",
        name: "db",
      },
      metadata: { annotations: {}, labels: { app: "db" } },
      spec: {},
    },
    {
      resourceId: "res-0000000000000003",
      evidenceId: "ev-daemonset-agent",
      identity: {
        apiVersion: "apps/v1",
        kind: "DaemonSet",
        namespace: "demo",
        name: "agent",
      },
      metadata: { annotations: {}, labels: { app: "agent" } },
      spec: {},
    },
    {
      resourceId: "res-0000000000000004",
      evidenceId: "ev-service-web",
      identity: {
        apiVersion: "v1",
        kind: "Service",
        namespace: "demo",
        name: "web",
      },
      metadata: { annotations: {}, labels: { app: "web" } },
      spec: {},
    },
  ],
};

describe("KubernetesSnapshotSchema", () => {
  it("accepts a snapshot containing each supported resource kind", () => {
    expect(KubernetesSnapshotSchema.parse(validSnapshot).resources).toHaveLength(4);
  });

  it("rejects an unsupported Secret resource", () => {
    const snapshotContainingSecret = {
      ...validSnapshot,
      resources: [
        ...validSnapshot.resources,
        {
          ...validSnapshot.resources[3],
          resourceId: "res-0000000000000005",
          evidenceId: "ev-secret-db",
          identity: {
            apiVersion: "v1",
            kind: "Secret",
            namespace: "demo",
            name: "db",
          },
        },
      ],
    };

    expect(() => KubernetesSnapshotSchema.parse(snapshotContainingSecret)).toThrow();
  });

  it("rejects a resource carrying server-owned status", () => {
    const snapshotWithStatus = {
      ...validSnapshot,
      resources: [{ ...validSnapshot.resources[0], status: { availableReplicas: 1 } }],
    };

    expect(() => KubernetesSnapshotSchema.parse(snapshotWithStatus)).toThrow();
  });

  it("rejects duplicate canonical identities", () => {
    const snapshotWithDuplicateIdentity = {
      ...validSnapshot,
      resources: [
        ...validSnapshot.resources,
        {
          ...validSnapshot.resources[0],
          resourceId: "res-0000000000000005",
          evidenceId: "ev-deployment-web-copy",
        },
      ],
    };

    expect(() => KubernetesSnapshotSchema.parse(snapshotWithDuplicateIdentity)).toThrow();
  });

  it("rejects duplicate resource ids", () => {
    const snapshotWithDuplicateResourceId = {
      ...validSnapshot,
      resources: [
        ...validSnapshot.resources,
        {
          ...validSnapshot.resources[1],
          evidenceId: "ev-statefulset-db-copy",
          identity: {
            apiVersion: "apps/v1",
            kind: "StatefulSet",
            namespace: "demo",
            name: "db-copy",
          },
        },
      ],
    };

    expect(() => KubernetesSnapshotSchema.parse(snapshotWithDuplicateResourceId)).toThrow();
  });

  it.each([
    ["clusterIP", "10.0.0.15"],
    ["clusterIPs", ["10.0.0.15"]],
    ["nodePort", 30080],
    ["unknownServiceField", true],
  ])("rejects Service spec field %s outside the normalized contract", (field, value) => {
    const snapshotWithServerAssignedServiceField = {
      ...validSnapshot,
      resources: validSnapshot.resources.map((resource) =>
        resource.identity.kind === "Service"
          ? { ...resource, spec: { [field]: value } }
          : resource,
      ),
    };

    expect(() => KubernetesSnapshotSchema.parse(snapshotWithServerAssignedServiceField)).toThrow();
  });

  it("rejects unknown workload spec fields", () => {
    const snapshotWithUnknownWorkloadField = {
      ...validSnapshot,
      resources: [{ ...validSnapshot.resources[0], spec: { hostIP: "192.0.2.10" } }],
    };

    expect(() => KubernetesSnapshotSchema.parse(snapshotWithUnknownWorkloadField)).toThrow();
  });

  it("accepts a DNS-subdomain resource name while keeping namespaces DNS labels", () => {
    const snapshotWithDottedResourceName = {
      ...validSnapshot,
      resources: [
        {
          ...validSnapshot.resources[0],
          identity: {
            ...validSnapshot.resources[0]!.identity,
            name: "web.v2.example",
          },
        },
      ],
    };
    const snapshotWithDottedNamespace = {
      ...snapshotWithDottedResourceName,
      resources: [
        {
          ...snapshotWithDottedResourceName.resources[0],
          identity: {
            ...snapshotWithDottedResourceName.resources[0]!.identity,
            namespace: "demo.example",
          },
        },
      ],
    };

    expect(() => KubernetesSnapshotSchema.parse(snapshotWithDottedResourceName)).not.toThrow();
    expect(() => KubernetesSnapshotSchema.parse(snapshotWithDottedNamespace)).toThrow();
  });

  it("accepts a valid 253-character DNS-subdomain resource name and rejects 254", () => {
    const maxLengthName = [
      "a".repeat(63),
      "b".repeat(63),
      "c".repeat(63),
      "d".repeat(61),
    ].join(".");
    const tooLongName = `${maxLengthName}e`;
    const snapshotWithMaxLengthName = {
      ...validSnapshot,
      resources: [
        {
          ...validSnapshot.resources[0],
          identity: { ...validSnapshot.resources[0]!.identity, name: maxLengthName },
        },
      ],
    };
    const snapshotWithTooLongName = {
      ...snapshotWithMaxLengthName,
      resources: [
        {
          ...snapshotWithMaxLengthName.resources[0],
          identity: { ...snapshotWithMaxLengthName.resources[0]!.identity, name: tooLongName },
        },
      ],
    };

    expect(maxLengthName).toHaveLength(253);
    expect(tooLongName).toHaveLength(254);
    expect(() => KubernetesSnapshotSchema.parse(snapshotWithMaxLengthName)).not.toThrow();
    expect(() => KubernetesSnapshotSchema.parse(snapshotWithTooLongName)).toThrow();
  });
});

describe("KubernetesChangeProposalSchema", () => {
  const operation = {
    path: "/resources/res-0000000000000001",
    value: validSnapshot.resources[0],
    reason: "Replace the captured workload declaration.",
    evidenceIds: ["ev-deployment-web"],
  };
  const proposal = {
    proposalId: "proposal-demo",
    summary: "Review a declarative Kubernetes update.",
    diagnosis: {
      likelyCause: "A manifest was supplied for deterministic review.",
      confidence: 0,
      evidenceIds: ["ev-snapshot-demo"],
      assumptions: [],
    },
    operations: [{ ...operation, op: "remove" }],
    rollbackOperations: [],
    verificationSteps: [],
  };

  it("rejects remove from forward operations", () => {
    expect(() => KubernetesChangeProposalSchema.parse(proposal)).toThrow();
  });

  it("allows remove in rollback operations to undo an add", () => {
    const proposalWithRollbackRemove = {
      ...proposal,
      operations: [{ ...operation, op: "add" }],
      rollbackOperations: [{ ...operation, op: "remove" }],
    };

    expect(() => KubernetesChangeProposalSchema.parse(proposalWithRollbackRemove)).not.toThrow();
  });

  it("rejects a replay fixture containing a forward remove", () => {
    const replayFixture = {
      fixtureId: "fixture-demo",
      scenarioId: "scenario-demo",
      provenance: "authored_synthetic",
      model: null,
      capturedAtUtc: null,
      notes: "A deterministic Kubernetes proposal fixture.",
      proposal,
    };

    expect(() => KubernetesReplayFixtureSchema.parse(replayFixture)).toThrow();
  });

  it("allows a replay fixture whose rollback removes an added resource", () => {
    const replayFixture = {
      fixtureId: "fixture-demo",
      scenarioId: "scenario-demo",
      provenance: "authored_synthetic",
      model: null,
      capturedAtUtc: null,
      notes: "A deterministic Kubernetes proposal fixture.",
      proposal: {
        ...proposal,
        operations: [{ ...operation, op: "add" }],
        rollbackOperations: [{ ...operation, op: "remove" }],
      },
    };

    expect(() => KubernetesReplayFixtureSchema.parse(replayFixture)).not.toThrow();
  });
});
