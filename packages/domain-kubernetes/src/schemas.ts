import {
  EvidenceIdSchema,
  FixtureProvenanceSchema,
  IdSchema,
  TimestampSchema,
  makeProposalSchemas,
} from "@changesafe/core";
import type { DomainAdapter } from "@changesafe/core";
import { z } from "zod";

/** Kubernetes kinds supported by the v1 offline snapshot contract. */
export const KubernetesKindSchema = z.enum([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Service",
]);

/** Namespaces are Kubernetes DNS labels, not arbitrary resource names. */
export const KubernetesNamespaceSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/, "Kubernetes DNS label required");

/**
 * Supported resource names use the Kubernetes DNS-subdomain form: dot-
 * separated DNS labels, up to 253 characters. Namespaces remain labels.
 */
export const KubernetesResourceNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?))*$/,
    "Kubernetes DNS subdomain required",
  );

/** FNV-1a resource identifiers are stable, not user-selected names. */
export const KubernetesResourceIdSchema = z
  .string()
  .regex(/^res-[a-f0-9]{16}$/, "Kubernetes resource ids are FNV-1a 64-bit ids");

/**
 * Canonical identity for every resource in a snapshot. Pairing the API
 * version and kind here prevents a resource from claiming an unsupported API.
 */
const KubernetesIdentityBaseShape = {
  namespace: KubernetesNamespaceSchema,
  name: KubernetesResourceNameSchema,
};

export const KubernetesDeploymentIdentitySchema = z.strictObject({
  ...KubernetesIdentityBaseShape,
  apiVersion: z.literal("apps/v1"),
  kind: z.literal("Deployment"),
});

export const KubernetesStatefulSetIdentitySchema = z.strictObject({
  ...KubernetesIdentityBaseShape,
  apiVersion: z.literal("apps/v1"),
  kind: z.literal("StatefulSet"),
});

export const KubernetesDaemonSetIdentitySchema = z.strictObject({
  ...KubernetesIdentityBaseShape,
  apiVersion: z.literal("apps/v1"),
  kind: z.literal("DaemonSet"),
});

export const KubernetesServiceIdentitySchema = z.strictObject({
  ...KubernetesIdentityBaseShape,
  apiVersion: z.literal("v1"),
  kind: z.literal("Service"),
});

/** The kind discriminant selects the only compatible API-version identity. */
export const KubernetesIdentitySchema = z.discriminatedUnion("kind", [
  KubernetesDeploymentIdentitySchema,
  KubernetesStatefulSetIdentitySchema,
  KubernetesDaemonSetIdentitySchema,
  KubernetesServiceIdentitySchema,
]);

/** Policy-relevant labels and annotations, after server-owned metadata is removed. */
export const KubernetesMetadataSchema = z.strictObject({
  annotations: z.record(z.string().min(1).max(253), z.string().max(8192)),
  labels: z.record(z.string().min(1).max(253), z.string().max(63)),
});

/**
 * A normalized resource. `spec` deliberately contains only data selected by
 * the kind-specific normalizer; status and server-assigned fields have no
 * place in this strict envelope.
 */
const KubernetesResourceBaseShape = {
  resourceId: KubernetesResourceIdSchema,
  evidenceId: EvidenceIdSchema,
  metadata: KubernetesMetadataSchema,
};

const KubernetesLabelMapSchema = z.record(z.string().min(1).max(253), z.string().max(63));

/** Pod/container fields evaluated by the Kubernetes safety policies. */
export const KubernetesContainerSecuritySchema = z.strictObject({
  privileged: z.boolean().optional(),
  allowPrivilegeEscalation: z.boolean().optional(),
  runAsUser: z.number().int().min(0).optional(),
  addedCapabilities: z.array(z.string().min(1).max(64)).max(64).optional(),
});

export const KubernetesContainerSchema = z.strictObject({
  name: KubernetesNamespaceSchema,
  image: z.string().min(1).max(1024),
  security: KubernetesContainerSecuritySchema.optional(),
});

const KubernetesWorkloadSpecBaseShape = {
  podLabels: KubernetesLabelMapSchema.optional(),
  containers: z.array(KubernetesContainerSchema).max(256).optional(),
  initContainers: z.array(KubernetesContainerSchema).max(256).optional(),
  podRunAsUser: z.number().int().min(0).optional(),
  hostNetwork: z.boolean().optional(),
  hostPID: z.boolean().optional(),
  hostIPC: z.boolean().optional(),
  hasHostPath: z.boolean().optional(),
};

export const KubernetesDeploymentSpecSchema = z.strictObject({
  ...KubernetesWorkloadSpecBaseShape,
  replicas: z.number().int().min(0).max(100000).optional(),
  strategy: z.enum(["RollingUpdate", "Recreate"]).optional(),
  maxUnavailable: z.union([z.number().int().min(0), z.string().regex(/^\d+%$/)]).optional(),
});

export const KubernetesStatefulSetSpecSchema = z.strictObject({
  ...KubernetesWorkloadSpecBaseShape,
  replicas: z.number().int().min(0).max(100000).optional(),
});

export const KubernetesDaemonSetSpecSchema = z.strictObject(KubernetesWorkloadSpecBaseShape);

export const KubernetesServiceSpecSchema = z.strictObject({
  type: z.enum(["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"]).optional(),
  selector: KubernetesLabelMapSchema.nullable().optional(),
});

/**
 * The resource's identity selects a strict, policy-relevant spec projection.
 * Server-assigned values such as Service cluster IPs and node ports never
 * enter the simulated state.
 */
export const KubernetesDeploymentResourceSchema = z.strictObject({
  ...KubernetesResourceBaseShape,
  identity: KubernetesDeploymentIdentitySchema,
  spec: KubernetesDeploymentSpecSchema,
});

export const KubernetesStatefulSetResourceSchema = z.strictObject({
  ...KubernetesResourceBaseShape,
  identity: KubernetesStatefulSetIdentitySchema,
  spec: KubernetesStatefulSetSpecSchema,
});

export const KubernetesDaemonSetResourceSchema = z.strictObject({
  ...KubernetesResourceBaseShape,
  identity: KubernetesDaemonSetIdentitySchema,
  spec: KubernetesDaemonSetSpecSchema,
});

export const KubernetesServiceResourceSchema = z.strictObject({
  ...KubernetesResourceBaseShape,
  identity: KubernetesServiceIdentitySchema,
  spec: KubernetesServiceSpecSchema,
});

export const KubernetesResourceSchema = z.union([
  KubernetesDeploymentResourceSchema,
  KubernetesStatefulSetResourceSchema,
  KubernetesDaemonSetResourceSchema,
  KubernetesServiceResourceSchema,
]);

/** Captured source information, stored without raw cluster connection details. */
export const KubernetesSnapshotProvenanceSchema = z.strictObject({
  source: z.enum(["cluster-api", "authored"]),
  collectedAtUtc: TimestampSchema,
  contextFingerprint: z.string().min(1).max(256),
  namespaces: z.array(KubernetesNamespaceSchema).min(1).max(256),
  serverVersion: z.string().min(1).max(128).nullable(),
});

/**
 * An offline cluster snapshot. Duplicate identities or ids would make the
 * simulated state ambiguous, so both are rejected at the boundary.
 */
export const KubernetesSnapshotSchema = z
  .strictObject({
    snapshotVersion: z.literal("changesafe-kubernetes-snapshot/v1"),
    snapshotId: IdSchema,
    evidenceId: EvidenceIdSchema,
    provenance: KubernetesSnapshotProvenanceSchema,
    resources: z.array(KubernetesResourceSchema).max(5000),
  })
  .superRefine((snapshot, ctx) => {
    const resourceIds = new Set<string>();
    const identities = new Set<string>();

    snapshot.resources.forEach((resource, index) => {
      if (resourceIds.has(resource.resourceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["resources", index, "resourceId"],
          message: `duplicate resource id "${resource.resourceId}"`,
        });
      }
      resourceIds.add(resource.resourceId);

      const { apiVersion, kind, namespace, name } = resource.identity;
      const identity = `${apiVersion}\u0000${kind}\u0000${namespace}\u0000${name}`;
      if (identities.has(identity)) {
        ctx.addIssue({
          code: "custom",
          path: ["resources", index, "identity"],
          message: `duplicate Kubernetes identity "${apiVersion}/${kind}/${namespace}/${name}"`,
        });
      }
      identities.add(identity);
    });
  });

/** State shape used by the simulated-state adapter in the next domain stage. */
export const KubernetesStateSchema = z
  .strictObject({
    resources: z.record(KubernetesResourceIdSchema, KubernetesResourceSchema),
  })
  .superRefine((state, ctx) => {
    for (const [resourceId, resource] of Object.entries(state.resources)) {
      if (resource.resourceId !== resourceId) {
        ctx.addIssue({
          code: "custom",
          path: ["resources", resourceId, "resourceId"],
          message: `resource record key "${resourceId}" must match resource.resourceId`,
        });
      }
    }
  });

/** Parsed YAML or JSON documents, kept as data until the pure normalizer runs. */
export const KubernetesManifestSetSchema = z.strictObject({
  documents: z.array(z.unknown()).max(5000),
});

const kubernetesProposalSchemas = makeProposalSchemas(KubernetesResourceSchema, {
  maxOperations: 5000,
});

/** Strict proposal schema: every forward and rollback value is a full resource. */
export const KubernetesChangeOperationSchema = kubernetesProposalSchemas.operation;
export const KubernetesChangeProposalSchema = kubernetesProposalSchemas.proposal.superRefine(
  (proposal, ctx) => {
    proposal.operations.forEach((operation, index) => {
      if (operation.op === "remove") {
        ctx.addIssue({
          code: "custom",
          path: ["operations", index, "op"],
          message: "Kubernetes forward operations may only add or replace resources",
        });
      }
    });
  },
);
/**
 * Replay fixtures use the same forward-operation contract as ordinary
 * Kubernetes proposals; a fixture cannot bypass the no-delete boundary.
 */
export const KubernetesReplayFixtureSchema = z
  .strictObject({
    fixtureId: IdSchema,
    scenarioId: IdSchema,
    provenance: FixtureProvenanceSchema,
    model: z.string().max(64).nullable(),
    capturedAtUtc: TimestampSchema.nullable(),
    notes: z.string().min(1).max(1000),
    proposal: KubernetesChangeProposalSchema,
  })
  .superRefine((fixture, ctx) => {
    if (fixture.provenance === "captured") {
      if (!fixture.model || !fixture.capturedAtUtc) {
        ctx.addIssue({
          code: "custom",
          path: ["provenance"],
          message: "captured fixtures must evidence model and capturedAtUtc metadata",
        });
      }
    } else if (fixture.model !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: "authored fixtures must not claim a model",
      });
    }
  });

export type KubernetesKind = z.infer<typeof KubernetesKindSchema>;
export type KubernetesIdentity = z.infer<typeof KubernetesIdentitySchema>;
export type KubernetesMetadata = z.infer<typeof KubernetesMetadataSchema>;
export type KubernetesDeploymentResource = z.infer<typeof KubernetesDeploymentResourceSchema>;
export type KubernetesStatefulSetResource = z.infer<typeof KubernetesStatefulSetResourceSchema>;
export type KubernetesDaemonSetResource = z.infer<typeof KubernetesDaemonSetResourceSchema>;
export type KubernetesServiceResource = z.infer<typeof KubernetesServiceResourceSchema>;
export type KubernetesResource = z.infer<typeof KubernetesResourceSchema>;
export type KubernetesSnapshotProvenance = z.infer<typeof KubernetesSnapshotProvenanceSchema>;
export type KubernetesSnapshot = z.infer<typeof KubernetesSnapshotSchema>;
export type KubernetesState = z.infer<typeof KubernetesStateSchema>;
export type KubernetesManifestSet = z.infer<typeof KubernetesManifestSetSchema>;
export type KubernetesChangeOperation = z.infer<typeof KubernetesChangeOperationSchema>;
export type KubernetesChangeProposal = z.infer<typeof KubernetesChangeProposalSchema>;
export type KubernetesReplayFixture = z.infer<typeof KubernetesReplayFixtureSchema>;

/** The Task 3 adapter will implement this specialized core contract. */
export type KubernetesDomainAdapter = DomainAdapter<KubernetesSnapshot, KubernetesState>;

/** The pure normalizer will return this pair once manifest derivation exists. */
export interface DerivedKubernetesProposal {
  proposal: KubernetesChangeProposal;
  resourceEvidenceIds: string[];
}
