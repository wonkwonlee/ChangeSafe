import { DomainError } from "@changesafe/core";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

import { identityKeyOf, resourceIdOf } from "./identity";
import { identityOfRawResource, normalizeRawResource } from "./normalize";
import {
  KubernetesChangeProposalSchema,
  KubernetesManifestSetSchema,
  KubernetesSnapshotSchema,
  type DerivedKubernetesProposal,
  type KubernetesChangeOperation,
  type KubernetesManifestSet,
  type KubernetesResource,
  type KubernetesSnapshot,
} from "./schemas";

const ManifestEnvelopeSchema = z.looseObject({
  metadata: z.looseObject({
    deletionTimestamp: z.unknown().optional(),
  }),
});

/** Parse YAML or JSON manifest text without treating any content as instructions. */
export function parseManifestDocuments(text: string): KubernetesManifestSet {
  let documents;
  try {
    documents = parseAllDocuments(text);
  } catch (error) {
    throw new DomainError("SCHEMA_VALIDATION", "The Kubernetes manifest text is invalid YAML.", {
      cause: error,
    });
  }

  const parseError = documents.find((document) => document.errors.length > 0);
  if (parseError) {
    throw new DomainError("SCHEMA_VALIDATION", "The Kubernetes manifest text is invalid YAML.", {
      cause: parseError.errors[0],
    });
  }

  return KubernetesManifestSetSchema.parse({
    documents: documents
      .map((document) => document.toJSON())
      .filter((document) => document !== null),
  });
}

function rejectManifestDeletionIntent(document: unknown): void {
  const parsed = ManifestEnvelopeSchema.safeParse(document);
  if (
    parsed.success &&
    Object.hasOwn(parsed.data.metadata, "deletionTimestamp")
  ) {
    throw new DomainError(
      "REQUEST_INVALID",
      "Kubernetes manifests containing metadata.deletionTimestamp express deletion intent and are not supported.",
    );
  }
}

function inverseOf(
  operation: KubernetesChangeOperation,
  previous: KubernetesResource | undefined,
): KubernetesChangeOperation {
  if (operation.op === "add") {
    return {
      op: "remove",
      path: operation.path,
      value: operation.value,
      reason: `Remove newly proposed ${operation.value.identity.kind} ${operation.value.identity.namespace}/${operation.value.identity.name}.`,
      evidenceIds: operation.evidenceIds,
    };
  }

  if (operation.op === "replace" && previous) {
    return {
      op: "replace",
      path: operation.path,
      value: previous,
      reason: `Restore captured ${previous.identity.kind} ${previous.identity.namespace}/${previous.identity.name}.`,
      evidenceIds: operation.evidenceIds,
    };
  }

  throw new DomainError(
    "INTERNAL",
    `Cannot derive a Kubernetes inverse for operation "${operation.op}" on "${operation.path}".`,
  );
}

/**
 * Turn manifest documents into deterministic add/replace operations. Omission
 * is deliberately not deletion, and every inverse is captured mechanically.
 */
export function deriveManifestProposal(
  snapshotInput: KubernetesSnapshot,
  manifestSetInput: KubernetesManifestSet,
): DerivedKubernetesProposal {
  const snapshot = KubernetesSnapshotSchema.parse(snapshotInput);
  const manifestSet = KubernetesManifestSetSchema.parse(manifestSetInput);
  const existingById = new Map<string, KubernetesResource>();
  const identitiesById = new Map<string, string>();
  for (const resource of snapshot.resources) {
    const canonicalResourceId = resourceIdOf(resource.identity);
    if (resource.resourceId !== canonicalResourceId) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Snapshot resource id "${resource.resourceId}" does not match canonical resource id "${canonicalResourceId}" for its identity.`,
      );
    }
    const identityKey = identityKeyOf(resource.identity);
    const priorIdentity = identitiesById.get(canonicalResourceId);
    if (priorIdentity !== undefined && priorIdentity !== identityKey) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Snapshot identities collide on canonical resource id "${canonicalResourceId}".`,
      );
    }
    identitiesById.set(canonicalResourceId, identityKey);
    existingById.set(canonicalResourceId, resource);
  }
  const seenManifestIdentities = new Set<string>();

  const proposedResources = manifestSet.documents.map((document) => {
    rejectManifestDeletionIntent(document);
    const identity = identityOfRawResource(document);
    const identityKey = identityKeyOf(identity);
    if (seenManifestIdentities.has(identityKey)) {
      throw new DomainError(
        "REQUEST_INVALID",
        `The manifests contain duplicate Kubernetes identity "${identity.apiVersion}/${identity.kind}/${identity.namespace}/${identity.name}".`,
      );
    }
    seenManifestIdentities.add(identityKey);

    const resourceId = resourceIdOf(identity);
    const priorIdentity = identitiesById.get(resourceId);
    if (priorIdentity !== undefined && priorIdentity !== identityKey) {
      throw new DomainError(
        "REQUEST_INVALID",
        `A manifest identity collides on resource id "${resourceId}".`,
      );
    }
    identitiesById.set(resourceId, identityKey);
    const existing = existingById.get(resourceId);
    const evidenceId = existing?.evidenceId ?? snapshot.evidenceId;
    return normalizeRawResource(document, evidenceId);
  });

  proposedResources.sort((left, right) =>
    left.resourceId < right.resourceId
      ? -1
      : left.resourceId > right.resourceId
        ? 1
        : 0,
  );

  if (proposedResources.length === 0) {
    throw new DomainError(
      "REQUEST_INVALID",
      "The manifests contain no supported resources to gate.",
    );
  }

  const operations: KubernetesChangeOperation[] = proposedResources.map((resource) => {
    const existing = existingById.get(resource.resourceId);
    return {
      op: existing ? "replace" : "add",
      path: `/resources/${resource.resourceId}`,
      value: resource,
      reason: `${existing ? "Replace captured" : "Add proposed"} ${resource.identity.kind} ${resource.identity.namespace}/${resource.identity.name}.`,
      evidenceIds: [existing?.evidenceId ?? snapshot.evidenceId],
    };
  });
  const inverseOperations = operations
    .map((operation) =>
      inverseOf(operation, existingById.get(operation.value.resourceId)),
    )
    .reverse();
  const existingResourceEvidenceIds = operations
    .filter((operation) => operation.op === "replace")
    .flatMap((operation) => operation.evidenceIds);

  const proposal = KubernetesChangeProposalSchema.parse({
    proposalId: `kubernetes-${snapshot.snapshotId}`,
    summary: "Gate proposed Kubernetes manifest upserts against the captured snapshot.",
    diagnosis: {
      likelyCause:
        "Declarative Kubernetes manifests were supplied for deterministic review.",
      confidence: 0,
      evidenceIds: [snapshot.evidenceId],
      assumptions: ["Manifest omission does not request resource deletion."],
    },
    operations,
    rollbackOperations: inverseOperations,
    verificationSteps: [
      {
        kind: "precondition",
        description:
          "Confirm the captured snapshot still represents the reviewed namespaces.",
        evidenceIds:
          existingResourceEvidenceIds.length > 0
            ? existingResourceEvidenceIds
            : [snapshot.evidenceId],
      },
      {
        kind: "postcheck",
        description:
          "Confirm workload availability and Service selector matches after human execution.",
        evidenceIds: [snapshot.evidenceId],
      },
    ],
  });

  return {
    proposal,
    resourceEvidenceIds: operations.flatMap((operation) => operation.evidenceIds),
  };
}
