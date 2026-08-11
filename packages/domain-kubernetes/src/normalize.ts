import { DomainError } from "@changesafe/core";
import { z } from "zod";

import { identityKeyOf, resourceIdOf } from "./identity";
import {
  KubernetesIdentitySchema,
  KubernetesResourceSchema,
  KubernetesSnapshotSchema,
  type KubernetesIdentity,
  type KubernetesResource,
  type KubernetesSnapshot,
} from "./schemas";

const StringMapSchema = z.record(z.string(), z.string());

const RawMetadataSchema = z.looseObject({
  name: z.string(),
  namespace: z.string().optional(),
  labels: StringMapSchema.optional(),
  annotations: StringMapSchema.optional(),
});

const RawContainerSecuritySchema = z.looseObject({
  privileged: z.boolean().optional(),
  allowPrivilegeEscalation: z.boolean().optional(),
  runAsUser: z.number().int().min(0).optional(),
  capabilities: z
    .looseObject({
      add: z.array(z.string()).optional(),
    })
    .optional(),
});

const RawContainerSchema = z.looseObject({
  name: z.string(),
  image: z.string(),
  securityContext: RawContainerSecuritySchema.optional(),
});

const RawPodSpecSchema = z.looseObject({
  containers: z.array(RawContainerSchema).optional(),
  initContainers: z.array(RawContainerSchema).optional(),
  securityContext: z.looseObject({ runAsUser: z.number().int().min(0).optional() }).optional(),
  hostNetwork: z.boolean().optional(),
  hostPID: z.boolean().optional(),
  hostIPC: z.boolean().optional(),
  volumes: z
    .array(
      z.looseObject({
        hostPath: z.unknown().optional(),
      }),
    )
    .optional(),
});

const RawPodTemplateSchema = z.looseObject({
  metadata: z
    .looseObject({
      labels: StringMapSchema.optional(),
    })
    .optional(),
  spec: RawPodSpecSchema.optional(),
});

const RawDeploymentSpecSchema = z.looseObject({
  replicas: z.number().int().min(0).optional(),
  strategy: z
    .looseObject({
      type: z.enum(["RollingUpdate", "Recreate"]).optional(),
      rollingUpdate: z
        .looseObject({
          maxUnavailable: z
            .union([z.number().int().min(0), z.string().regex(/^\d+%$/)])
            .optional(),
        })
        .optional(),
    })
    .optional(),
  template: RawPodTemplateSchema.optional(),
});

const RawStatefulSetSpecSchema = z.looseObject({
  replicas: z.number().int().min(0).optional(),
  template: RawPodTemplateSchema.optional(),
});

const RawDaemonSetSpecSchema = z.looseObject({
  template: RawPodTemplateSchema.optional(),
});

const RawServiceSpecSchema = z.looseObject({
  type: z.enum(["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"]).optional(),
  selector: StringMapSchema.nullable().optional(),
});

const RawResourceEnvelopeSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: RawMetadataSchema,
  spec: z.unknown().optional(),
});

const RawSnapshotSchema = z.strictObject({
  snapshotVersion: z.literal("changesafe-kubernetes-snapshot/v1"),
  snapshotId: z.string(),
  evidenceId: z.string(),
  provenance: z.unknown(),
  resources: z.array(z.unknown()),
});

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  userMessage: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("SCHEMA_VALIDATION", userMessage, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function sortRecord(values: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values ?? {}).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

/** Read and validate identity before projecting a raw resource. */
export function identityOfRawResource(raw: unknown): KubernetesIdentity {
  const envelope = parseOrThrow(
    RawResourceEnvelopeSchema,
    raw,
    "A Kubernetes resource is missing its API version, kind, name, or metadata.",
  );
  const identity = {
    apiVersion: envelope.apiVersion,
    kind: envelope.kind,
    namespace: envelope.metadata.namespace ?? "default",
    name: envelope.metadata.name,
  };
  const parsed = KubernetesIdentitySchema.safeParse(identity);
  if (!parsed.success) {
    throw new DomainError(
      "SCHEMA_VALIDATION",
      `Kubernetes kind "${envelope.apiVersion}/${envelope.kind}" is unsupported or has an invalid identity.`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function normalizeContainers(containers: z.infer<typeof RawContainerSchema>[] | undefined) {
  if (!containers) return undefined;

  return containers.map((container) => {
    const securityContext = container.securityContext;
    const security =
      securityContext === undefined
        ? undefined
        : {
            ...(securityContext.privileged === undefined
              ? {}
              : { privileged: securityContext.privileged }),
            ...(securityContext.allowPrivilegeEscalation === undefined
              ? {}
              : {
                  allowPrivilegeEscalation:
                    securityContext.allowPrivilegeEscalation,
                }),
            ...(securityContext.runAsUser === undefined
              ? {}
              : { runAsUser: securityContext.runAsUser }),
            ...(securityContext.capabilities?.add === undefined
              ? {}
              : {
                  addedCapabilities: [
                    ...securityContext.capabilities.add,
                  ].sort(),
                }),
          };

    return {
      name: container.name,
      image: container.image,
      ...(security === undefined || Object.keys(security).length === 0
        ? {}
        : { security }),
    };
  });
}

function normalizePodSpec(template: z.infer<typeof RawPodTemplateSchema> | undefined) {
  const podSpec = template?.spec;
  const containers = normalizeContainers(podSpec?.containers);
  const initContainers = normalizeContainers(podSpec?.initContainers);
  return {
    ...(template?.metadata?.labels === undefined
      ? {}
      : { podLabels: sortRecord(template.metadata.labels) }),
    ...(containers === undefined ? {} : { containers }),
    ...(initContainers === undefined ? {} : { initContainers }),
    ...(podSpec?.securityContext?.runAsUser === undefined
      ? {}
      : { podRunAsUser: podSpec.securityContext.runAsUser }),
    hostNetwork: podSpec?.hostNetwork ?? false,
    hostPID: podSpec?.hostPID ?? false,
    hostIPC: podSpec?.hostIPC ?? false,
    hasHostPath: podSpec?.volumes?.some((volume) => volume.hostPath !== undefined) ?? false,
  };
}

/**
 * Project a raw Kubernetes API object into the strict policy-relevant model.
 * Server-owned metadata, status, and unselected spec fields are discarded.
 */
export function normalizeRawResource(
  raw: unknown,
  evidenceId: string,
): KubernetesResource {
  const envelope = parseOrThrow(
    RawResourceEnvelopeSchema,
    raw,
    "A Kubernetes resource is malformed.",
  );
  const identity = identityOfRawResource(envelope);
  const resourceId = resourceIdOf(identity);
  const metadata = {
    annotations: sortRecord(envelope.metadata.annotations),
    labels: sortRecord(envelope.metadata.labels),
  };

  let spec: KubernetesResource["spec"];
  switch (identity.kind) {
    case "Deployment": {
      const rawSpec = parseOrThrow(
        RawDeploymentSpecSchema,
        envelope.spec ?? {},
        "A Kubernetes Deployment spec is malformed.",
      );
      const strategy = rawSpec.strategy?.type ?? "RollingUpdate";
      spec = {
        ...normalizePodSpec(rawSpec.template),
        replicas: rawSpec.replicas ?? 1,
        strategy,
        ...(strategy === "RollingUpdate"
          ? {
              maxUnavailable:
                rawSpec.strategy?.rollingUpdate?.maxUnavailable ?? "25%",
            }
          : {}),
      };
      break;
    }
    case "StatefulSet": {
      const rawSpec = parseOrThrow(
        RawStatefulSetSpecSchema,
        envelope.spec ?? {},
        "A Kubernetes StatefulSet spec is malformed.",
      );
      spec = {
        ...normalizePodSpec(rawSpec.template),
        replicas: rawSpec.replicas ?? 1,
      };
      break;
    }
    case "DaemonSet": {
      const rawSpec = parseOrThrow(
        RawDaemonSetSpecSchema,
        envelope.spec ?? {},
        "A Kubernetes DaemonSet spec is malformed.",
      );
      spec = normalizePodSpec(rawSpec.template);
      break;
    }
    case "Service": {
      const rawSpec = parseOrThrow(
        RawServiceSpecSchema,
        envelope.spec ?? {},
        "A Kubernetes Service spec is malformed.",
      );
      spec = {
        type: rawSpec.type ?? "ClusterIP",
        selector:
          rawSpec.selector === undefined ? null : rawSpec.selector === null
            ? null
            : sortRecord(rawSpec.selector),
      };
      break;
    }
  }

  return parseOrThrow(
    KubernetesResourceSchema,
    { resourceId, evidenceId, identity, metadata, spec },
    "A Kubernetes resource could not be normalized into the supported contract.",
  );
}

/** Normalize and deterministically order an offline raw collector snapshot. */
export function normalizeSnapshot(raw: unknown): KubernetesSnapshot {
  const snapshot = parseOrThrow(
    RawSnapshotSchema,
    raw,
    "The file is not a recognizable Kubernetes snapshot.",
  );
  const seenIdentities = new Set<string>();
  const identitiesByResourceId = new Map<string, string>();
  const resources = snapshot.resources.map((resource) => {
    const identity = identityOfRawResource(resource);
    const identityKey = identityKeyOf(identity);
    if (seenIdentities.has(identityKey)) {
      throw new DomainError(
        "REQUEST_INVALID",
        `The snapshot contains duplicate Kubernetes identity "${identity.apiVersion}/${identity.kind}/${identity.namespace}/${identity.name}".`,
      );
    }
    seenIdentities.add(identityKey);

    const resourceId = resourceIdOf(identity);
    const priorIdentity = identitiesByResourceId.get(resourceId);
    if (priorIdentity !== undefined && priorIdentity !== identityKey) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Two Kubernetes identities collide on resource id "${resourceId}".`,
      );
    }
    identitiesByResourceId.set(resourceId, identityKey);
    return normalizeRawResource(resource, `ev-${resourceId}`);
  });

  resources.sort((left, right) =>
    left.resourceId < right.resourceId
      ? -1
      : left.resourceId > right.resourceId
        ? 1
        : 0,
  );

  return parseOrThrow(
    KubernetesSnapshotSchema,
    {
      snapshotVersion: snapshot.snapshotVersion,
      snapshotId: snapshot.snapshotId,
      evidenceId: snapshot.evidenceId,
      provenance: snapshot.provenance,
      resources,
    },
    "The normalized Kubernetes snapshot violates the supported contract.",
  );
}
