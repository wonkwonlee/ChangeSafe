import { z } from "zod";
import { DomainError } from "@changesafe/core";
import {
  canonicalizeAdmittedResource, deriveManifestProposal, kubernetesObjectSha256,
  normalizeSnapshot, parseManifestDocuments, resourceIdOf,
} from "@changesafe/domain-kubernetes";
import type { DecisionRequest } from "./decisions";

export const GrantPreferencesSchema = z.strictObject({
  authorizedActor: z.string().min(1).max(255),
  authorizedActorUid: z.string().min(1).max(255).optional(),
  expiresAtUtc: z.iso.datetime({ precision: 3 }),
});

function kubernetesReviewArtifacts(request: Pick<DecisionRequest, "input">) {
  // The lossy derived proposal cannot bind command/env/metadata fields.
  // Grant issuance therefore requires the complete bundle hashed by the receipt.
  return z.strictObject({ snapshot: z.unknown(), manifestText: z.string().min(1) }).parse(request.input);
}

/** Only immutable reviewed artifacts choose the operation and target. */
export async function deriveReviewedGrantBinding(request: DecisionRequest) {
  if (request.domain !== "kubernetes") {
    throw new DomainError("REQUEST_INVALID", "Only Kubernetes has a reviewed grant issuance contract.");
  }
  const artifacts = kubernetesReviewArtifacts(request);
  const raw = z.object({ resources: z.array(z.unknown()) }).parse(artifacts.snapshot);
  const snapshot = normalizeSnapshot(artifacts.snapshot);
  const manifests = parseManifestDocuments(artifacts.manifestText);
  if (manifests.documents.length !== 1) {
    throw new DomainError("REQUEST_INVALID", "One grant requires exactly one reviewed manifest.");
  }
  const { proposal } = deriveManifestProposal(snapshot, manifests);
  if (proposal.operations.length !== 1) {
    throw new DomainError("REQUEST_INVALID", "One grant requires exactly one reviewed resource operation.");
  }
  const target = manifests.documents[0];
  const identity = canonicalizeAdmittedResource(target, "ev-grant").identity;
  const resource = resourceIdOf(identity);
  const prior = raw.resources.find((entry) =>
    resourceIdOf(canonicalizeAdmittedResource(entry, "ev-grant").identity) === resource);
  if (prior === undefined) {
    return { operation: "CREATE" as const, resource, objectSha256: await kubernetesObjectSha256(target) };
  }
  const resourceUid = z.object({ metadata: z.object({ uid: z.string().min(1).max(255) }) }).parse(prior).metadata.uid;
  return {
    operation: "UPDATE" as const, resource, resourceUid,
    objectSha256: await kubernetesObjectSha256(target),
    oldObjectSha256: await kubernetesObjectSha256(prior),
  };
}
