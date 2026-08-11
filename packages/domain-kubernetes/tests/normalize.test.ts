import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { canonicalize } from "@changesafe/core";
import {
  deriveManifestProposal,
  normalizeSnapshot,
  parseManifestDocuments,
  resourceIdOf,
} from "@changesafe/domain-kubernetes";
import { describe, expect, it } from "vitest";

import currentSnapshot from "./fixtures/current.snapshot.json";

function fixtureText(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

const deploymentIdentity = {
  apiVersion: "apps/v1" as const,
  kind: "Deployment" as const,
  namespace: "demo",
  name: "web",
};

describe("normalizeSnapshot", () => {
  it("normalizes resource order without changing canonical output", () => {
    const snapshotWithResourcesReordered = {
      ...currentSnapshot,
      resources: [...currentSnapshot.resources].reverse(),
    };

    expect(canonicalize(normalizeSnapshot(currentSnapshot))).toBe(
      canonicalize(normalizeSnapshot(snapshotWithResourcesReordered)),
    );
  });

  it("uses stable identity-derived ids", () => {
    expect(resourceIdOf(deploymentIdentity)).toBe(resourceIdOf({ ...deploymentIdentity }));
    expect(resourceIdOf(deploymentIdentity)).toMatch(/^res-[a-f0-9]{16}$/);
  });

  it("projects policy-relevant fields and removes server-owned data", () => {
    const normalized = normalizeSnapshot(currentSnapshot);
    const deployment = normalized.resources.find(
      (resource) => resource.identity.kind === "Deployment",
    );

    expect(deployment).toEqual({
      resourceId: resourceIdOf(deploymentIdentity),
      evidenceId: `ev-${resourceIdOf(deploymentIdentity)}`,
      identity: deploymentIdentity,
      metadata: {
        annotations: { "example.com/owner": "platform" },
        labels: { app: "web", tier: "frontend" },
      },
      spec: {
        replicas: 2,
        strategy: "RollingUpdate",
        maxUnavailable: "25%",
        podLabels: { app: "web" },
        containers: [
          {
            name: "web",
            image: "registry.example.invalid/web:v1",
            security: {
              allowPrivilegeEscalation: false,
              runAsUser: 1000,
              addedCapabilities: ["NET_BIND_SERVICE"],
            },
          },
        ],
        hostNetwork: false,
        hostPID: false,
        hostIPC: false,
        hasHostPath: false,
      },
    });
    for (const resource of normalized.resources) {
      expect(resource).not.toHaveProperty("status");
      expect(resource).not.toHaveProperty("metadata.uid");
      expect(resource).not.toHaveProperty("metadata.resourceVersion");
    }
  });

  it("strips deletion timestamps from raw snapshot resources", () => {
    const rawDeployment = currentSnapshot.resources[0];
    if (!rawDeployment) {
      throw new Error("fixture must contain a Deployment");
    }
    const snapshotWithDeletingResource = {
      ...currentSnapshot,
      resources: [
        {
          ...rawDeployment,
          metadata: {
            ...rawDeployment.metadata,
            deletionTimestamp: "2026-07-28T00:05:00.000Z",
          },
        },
      ],
    };

    const normalized = normalizeSnapshot(snapshotWithDeletingResource);

    expect(normalized.resources[0]).not.toHaveProperty("metadata.deletionTimestamp");
  });

  it("normalizes pod security and init containers for privilege policies", () => {
    const rawDeployment = currentSnapshot.resources[0];
    if (!rawDeployment) throw new Error("fixture must contain a Deployment");
    const normalized = normalizeSnapshot({
      ...currentSnapshot,
      resources: [{
        ...rawDeployment,
        spec: {
          ...rawDeployment.spec,
          template: {
            ...rawDeployment.spec.template,
            spec: {
              ...rawDeployment.spec.template.spec,
              securityContext: { runAsUser: 0 },
              initContainers: [{
                name: "setup",
                image: "registry.example.invalid/setup:v1",
                securityContext: { privileged: true, allowPrivilegeEscalation: false },
              }],
            },
          },
        },
      }],
    });
    expect(normalized.resources[0]?.spec).toMatchObject({
      podRunAsUser: 0,
      initContainers: [{ name: "setup", security: { privileged: true } }],
    });
  });

  it("normalizes Kubernetes defaults explicitly", () => {
    const normalized = normalizeSnapshot(currentSnapshot);
    const statefulSet = normalized.resources.find(
      (resource) => resource.identity.kind === "StatefulSet",
    );

    expect(statefulSet).toMatchObject({
      identity: {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        namespace: "default",
        name: "database",
      },
      metadata: { annotations: {}, labels: {} },
      spec: {
        replicas: 1,
        hostNetwork: false,
        hostPID: false,
        hostIPC: false,
        hasHostPath: false,
      },
    });
  });

  it("rejects duplicate canonical identities", () => {
    const snapshotWithCollision = {
      ...currentSnapshot,
      resources: [currentSnapshot.resources[0], { ...currentSnapshot.resources[0] }],
    };

    expect(() => normalizeSnapshot(snapshotWithCollision)).toThrow(/duplicate/i);
  });
});

describe("manifest-derived proposals", () => {
  const safeManifests = () => parseManifestDocuments(fixtureText("safe-update.yaml"));

  it("parses every non-empty YAML document", () => {
    expect(safeManifests().documents).toHaveLength(2);
  });

  it("derives one replace and one add while ignoring omitted resources", () => {
    const snapshot = normalizeSnapshot(currentSnapshot);
    const derived = deriveManifestProposal(snapshot, safeManifests());
    const deploymentOperation = derived.proposal.operations.find(
      (operation) => operation.value.identity.kind === "Deployment",
    );
    const serviceOperation = derived.proposal.operations.find(
      (operation) => operation.value.identity.kind === "Service",
    );

    expect(derived.proposal.operations).toHaveLength(2);
    expect(deploymentOperation).toMatchObject({
      op: "replace",
      path: `/resources/${resourceIdOf(deploymentIdentity)}`,
      evidenceIds: [`ev-${resourceIdOf(deploymentIdentity)}`],
    });
    expect(serviceOperation).toMatchObject({
      op: "add",
      evidenceIds: [snapshot.evidenceId],
    });
    expect(
      derived.proposal.operations.some(
        (operation) => operation.value.identity.name === "database",
      ),
    ).toBe(false);
  });

  it("derives exact rollback values for replace and add", () => {
    const snapshot = normalizeSnapshot(currentSnapshot);
    const derived = deriveManifestProposal(snapshot, safeManifests());
    const currentDeployment = snapshot.resources.find(
      (resource) => resource.identity.kind === "Deployment",
    );
    const deploymentForward = derived.proposal.operations.find(
      (operation) => operation.value.identity.kind === "Deployment",
    );
    const deploymentRollback = derived.proposal.rollbackOperations.find(
      (operation) => operation.value.identity.kind === "Deployment",
    );
    const serviceForward = derived.proposal.operations.find(
      (operation) => operation.value.identity.kind === "Service",
    );
    const serviceRollback = derived.proposal.rollbackOperations.find(
      (operation) => operation.value.identity.kind === "Service",
    );

    expect(deploymentForward?.op).toBe("replace");
    expect(deploymentRollback).toMatchObject({
      op: "replace",
      path: deploymentForward?.path,
      value: currentDeployment,
    });
    expect(serviceForward?.op).toBe("add");
    expect(serviceRollback).toMatchObject({
      op: "remove",
      path: serviceForward?.path,
      value: serviceForward?.value,
    });
  });

  it("is deterministic when manifest documents are reordered", () => {
    const snapshot = normalizeSnapshot(currentSnapshot);
    const manifests = safeManifests();
    const reordered = { documents: [...manifests.documents].reverse() };

    expect(canonicalize(deriveManifestProposal(snapshot, manifests))).toBe(
      canonicalize(deriveManifestProposal(snapshot, reordered)),
    );
  });

  it("uses the required deterministic proposal envelope", () => {
    const snapshot = normalizeSnapshot(currentSnapshot);
    const derived = deriveManifestProposal(snapshot, safeManifests());
    const replacementEvidenceIds = derived.proposal.operations
      .filter((operation) => operation.op === "replace")
      .flatMap((operation) => operation.evidenceIds);

    expect(derived.proposal).toMatchObject({
      proposalId: `kubernetes-${snapshot.snapshotId}`,
      summary: "Gate proposed Kubernetes manifest upserts against the captured snapshot.",
      diagnosis: {
        likelyCause:
          "Declarative Kubernetes manifests were supplied for deterministic review.",
        confidence: 0,
        evidenceIds: [snapshot.evidenceId],
        assumptions: ["Manifest omission does not request resource deletion."],
      },
      verificationSteps: [
        {
          kind: "precondition",
          description:
            "Confirm the captured snapshot still represents the reviewed namespaces.",
          evidenceIds: replacementEvidenceIds,
        },
        {
          kind: "postcheck",
          description:
            "Confirm workload availability and Service selector matches after human execution.",
          evidenceIds: [snapshot.evidenceId],
        },
      ],
    });
    expect(derived.resourceEvidenceIds).toEqual(
      derived.proposal.operations.flatMap((operation) => operation.evidenceIds),
    );
  });

  it("uses snapshot evidence for an all-add proposal", () => {
    const snapshot = normalizeSnapshot({ ...currentSnapshot, resources: [] });
    const serviceDocument = safeManifests().documents[1];
    const derived = deriveManifestProposal(snapshot, { documents: [serviceDocument] });

    expect(derived.proposal.operations[0]?.evidenceIds).toEqual([snapshot.evidenceId]);
    expect(derived.proposal.verificationSteps[0]?.evidenceIds).toEqual([
      snapshot.evidenceId,
    ]);
  });

  it("rejects duplicate manifest identities", () => {
    const snapshot = normalizeSnapshot(currentSnapshot);
    const manifests = safeManifests();

    expect(() =>
      deriveManifestProposal(snapshot, {
        documents: [...manifests.documents, manifests.documents[0]],
      }),
    ).toThrow(/duplicate/i);
  });

  it("rejects deletion intent in a supported manifest", () => {
    const snapshot = normalizeSnapshot(currentSnapshot);
    const rawDeployment = currentSnapshot.resources[0];
    if (!rawDeployment) {
      throw new Error("fixture must contain a Deployment");
    }
    const deletingDeployment = {
      ...rawDeployment,
      metadata: {
        ...rawDeployment.metadata,
        deletionTimestamp: "2026-07-28T00:05:00.000Z",
      },
    };

    expect(() =>
      deriveManifestProposal(snapshot, { documents: [deletingDeployment] }),
    ).toThrow(/deletionTimestamp|deletion intent/i);
  });

  it("rejects a snapshot resource id inconsistent with its identity", () => {
    const snapshot = normalizeSnapshot(currentSnapshot);
    const deployment = snapshot.resources.find(
      (resource) => resource.identity.kind === "Deployment",
    );
    if (!deployment) {
      throw new Error("fixture must contain a Deployment");
    }
    const snapshotWithInconsistentId = {
      ...snapshot,
      resources: snapshot.resources.map((resource) =>
        resource.identity.kind === "Deployment"
          ? { ...resource, resourceId: "res-ffffffffffffffff" }
          : resource,
      ),
    };

    expect(() =>
      deriveManifestProposal(snapshotWithInconsistentId, safeManifests()),
    ).toThrow(/resource id.*identity|canonical resource id/i);
  });

  it("rejects unsupported manifest kinds", () => {
    const snapshot = normalizeSnapshot(currentSnapshot);
    const unsupported = parseManifestDocuments(fixtureText("unsupported-secret.yaml"));

    expect(() => deriveManifestProposal(snapshot, unsupported)).toThrow(/unsupported/i);
  });
});
