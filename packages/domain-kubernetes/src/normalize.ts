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
 * Canonicalize a raw Kubernetes API object for exact-object authorization
 * binding (grant issuance and admission-time verification) — NOT for policy
 * evaluation. Unlike `normalizeRawResource`, this keeps the entire `spec`
 * verbatim rather than projecting it down to the fields today's policies
 * happen to read: a grant must bind to the object actually admitted,
 * including fields no policy currently inspects (container `command`,
 * `args`, `env`, `resources`, `ports`; Service `ports`; volumes; ...).
 * Reusing the policy projection for this purpose was CS-ADV-005 — it let an
 * UPDATE change any field the projection discards while keeping the same
 * hash, so a grant for one workload authorized a materially different one.
 *
 * `metadata` keeps every field EXCEPT the explicit server-owned/managed
 * keys below (plus `name`/`namespace`, already carried in `identity`) —
 * the same server-owned-field exclusion Decision 5 always intended, just
 * applied without discarding real spec content alongside it. This is an
 * exclude-list, not an include-list, deliberately: an include-list of
 * "known" client fields (as the first version of this function had, and
 * as `normalizeRawResource`'s `annotations`/`labels`-only projection still
 * has) silently drops any client-settable field nobody thought to name —
 * `finalizers` and `ownerReferences` are both real, client-controllable
 * fields an UPDATE can carry, and both were missing from that first
 * version. An unrecognized FUTURE metadata field defaults to being
 * INCLUDED in the hash under this list, which can only cost an extra
 * false DENY, never a false ALLOW — see the failure-direction note below.
 *
 * `spec`'s own K8s-server-side defaulting (e.g. an unset `strategy.type`
 * becoming `"RollingUpdate"`) is deliberately NOT normalized away: a grant
 * issued against a manifest that omits a field the API server later
 * defaults can therefore mismatch and DENY at admission time. That is the
 * safe failure direction for an authorization gate — a spurious DENY is a
 * usability cost; a spurious ALLOW is a security bypass. Callers issuing
 * grants should compute this hash against the object as the API server
 * will actually see it (e.g. via a dry-run apply), not the raw authored
 * manifest, to avoid the false-DENY case in practice.
 *
 * `deletionTimestamp`/`deletionGracePeriodSeconds` are deliberately NOT
 * excluded, unlike the true server-bookkeeping fields below: they record
 * whether a deletion has been requested, a lifecycle change that alters
 * what an UPDATE grant means. A grant reviewed against a not-yet-deleting
 * object (e.g. "remove this finalizer") must not silently also authorize
 * removing that finalizer once the object has entered termination —
 * finalizer removal on a terminating object triggers actual garbage
 * collection, a materially different, unreviewed outcome (`CS-ADV-015`).
 */
const SERVER_OWNED_METADATA_KEYS = [
  "name",
  "namespace",
  "uid",
  "resourceVersion",
  "generation",
  "creationTimestamp",
  "managedFields",
  "selfLink",
  "clusterName",
] as const;

export function canonicalizeAdmittedResource(
  raw: unknown,
  evidenceId: string,
): { evidenceId: string; identity: KubernetesIdentity; metadata: Record<string, unknown>; spec: unknown } {
  const envelope = parseOrThrow(
    RawResourceEnvelopeSchema,
    raw,
    "A Kubernetes resource is malformed.",
  );
  const identity = identityOfRawResource(envelope);
  const metadata: Record<string, unknown> = { ...envelope.metadata };
  for (const key of SERVER_OWNED_METADATA_KEYS) delete metadata[key];
  if (metadata.annotations !== undefined) {
    metadata.annotations = sortRecord(metadata.annotations as Record<string, string>);
  }
  if (metadata.labels !== undefined) {
    metadata.labels = sortRecord(metadata.labels as Record<string, string>);
  }
  return {
    evidenceId,
    identity,
    metadata,
    spec: envelope.spec ?? {},
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
