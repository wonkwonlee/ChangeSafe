import { DomainError } from "@changesafe/core";
import {
  KubernetesChangeProposalSchema,
  deriveManifestProposal,
  normalizeSnapshot,
  type KubernetesChangeProposal,
  type KubernetesSnapshot,
} from "@changesafe/domain-kubernetes/offline";

/**
 * Offline, fictional Kubernetes replay inputs for the public workbench.
 *
 * These are TypeScript data rather than imports of the package's YAML test
 * files.  That keeps YAML parsers and raw manifest assets out of route and
 * client bundles while still exercising the package's production normalizer
 * and deterministic manifest-to-proposal derivation.
 */
const rawSnapshot = {
  snapshotVersion: "changesafe-kubernetes-snapshot/v1",
  snapshotId: "snapshot-public-kubernetes-demo",
  evidenceId: "ev-kubernetes-public-snapshot",
  provenance: {
    source: "authored",
    collectedAtUtc: "2026-07-29T00:00:00.000Z",
    contextFingerprint: "fictional-public-kubernetes-demo",
    namespaces: ["demo"],
    serverVersion: "v1.31.0",
  },
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "web",
        namespace: "demo",
        labels: { app: "web", tier: "frontend" },
        annotations: { "example.invalid/owner": "platform" },
      },
      spec: {
        replicas: 2,
        strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1 } },
        template: {
          metadata: { labels: { app: "web" } },
          spec: {
            containers: [
              {
                name: "web",
                image: "registry.example.invalid/web:v1",
                securityContext: {
                  allowPrivilegeEscalation: false,
                  runAsUser: 1000,
                },
              },
            ],
          },
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
} as const;

const safeScaleManifest = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: {
    name: "web",
    namespace: "demo",
    labels: { app: "web", tier: "frontend" },
    annotations: { "example.invalid/owner": "platform" },
  },
  spec: {
    replicas: 3,
    strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1 } },
    template: {
      metadata: { labels: { app: "web" } },
      spec: {
        containers: [
          {
            name: "web",
            image: "registry.example.invalid/web:v2",
            securityContext: { allowPrivilegeEscalation: false, runAsUser: 1000 },
          },
        ],
      },
    },
  },
} as const;

const selectorBreakingManifest = {
  ...safeScaleManifest,
  spec: {
    ...safeScaleManifest.spec,
    template: {
      ...safeScaleManifest.spec.template,
      metadata: { labels: { app: "untrusted-replacement" } },
    },
  },
} as const;

const unsupportedSecretManifest = {
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: "database-credentials", namespace: "demo" },
  type: "Opaque",
  stringData: { username: "fictional-user", password: "fictional-password" },
} as const;

export const KUBERNETES_PUBLIC_REPLAY_SNAPSHOT: KubernetesSnapshot =
  normalizeSnapshot(rawSnapshot);

export interface KubernetesPublicReplayFixture {
  readonly kind: "replay";
  readonly sourceId: "kubernetes-safe-scale" | "kubernetes-selector-red-team";
  readonly inputId: string;
  readonly label: string;
  readonly description: string;
  readonly provenance: "authored-synthetic" | "authored-red-team";
  readonly manifestDocuments: readonly unknown[];
  readonly proposal: KubernetesChangeProposal;
}

export interface KubernetesUnsupportedPublicReplaySource {
  readonly kind: "unsupported";
  readonly sourceId: "kubernetes-unsupported-secret";
  readonly label: string;
  readonly description: string;
  readonly provenance: "authored-red-team";
  readonly manifestDocuments: readonly unknown[];
  readonly rejection: "unsupported-manifest-kind";
}

export type KubernetesPublicReplaySource =
  | KubernetesPublicReplayFixture
  | KubernetesUnsupportedPublicReplaySource;

function deriveFixture(
  sourceId: KubernetesPublicReplayFixture["sourceId"],
  inputId: string,
  label: string,
  description: string,
  provenance: KubernetesPublicReplayFixture["provenance"],
  manifest: unknown,
): KubernetesPublicReplayFixture {
  const manifestDocuments = Object.freeze([manifest]);
  const proposal = KubernetesChangeProposalSchema.parse(
    deriveManifestProposal(KUBERNETES_PUBLIC_REPLAY_SNAPSHOT, {
      documents: [...manifestDocuments],
    }).proposal,
  );
  return Object.freeze({
    kind: "replay",
    sourceId,
    inputId,
    label,
    description,
    provenance,
    manifestDocuments,
    proposal,
  });
}

export const KUBERNETES_PUBLIC_REPLAY_FIXTURES: readonly KubernetesPublicReplayFixture[] =
  Object.freeze([
    deriveFixture(
      "kubernetes-safe-scale",
      "kubernetes-safe-scale",
      "Safe web scale-up",
      "A fictional offline Deployment scale-up evaluated in the Kubernetes sandbox.",
      "authored-synthetic",
      safeScaleManifest,
    ),
    deriveFixture(
      "kubernetes-selector-red-team",
      "kubernetes-selector-red-team",
      "Service selector break",
      "A fictional red-team manifest that leaves the existing Service selector without a workload match.",
      "authored-red-team",
      selectorBreakingManifest,
    ),
  ]);

export const KUBERNETES_UNSUPPORTED_PUBLIC_REPLAY_SOURCE: KubernetesUnsupportedPublicReplaySource =
  Object.freeze({
    kind: "unsupported",
    sourceId: "kubernetes-unsupported-secret",
    label: "Unsupported Secret manifest",
    description:
      "A fictional adversarial Secret manifest. Secrets are outside the offline Kubernetes v1 contract and are rejected before review.",
    provenance: "authored-red-team",
    manifestDocuments: Object.freeze([unsupportedSecretManifest]),
    rejection: "unsupported-manifest-kind",
  });

export const KUBERNETES_PUBLIC_REPLAY_SOURCES: readonly KubernetesPublicReplaySource[] =
  Object.freeze([
    ...KUBERNETES_PUBLIC_REPLAY_FIXTURES,
    KUBERNETES_UNSUPPORTED_PUBLIC_REPLAY_SOURCE,
  ]);

/** Resolve only a supported replay fixture; unsupported sources never yield a proposal or result. */
export function resolveKubernetesPublicReplayFixture(
  sourceId: string,
): KubernetesPublicReplayFixture {
  const source = KUBERNETES_PUBLIC_REPLAY_SOURCES.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!source) {
    throw new DomainError("REQUEST_INVALID", `Unknown Kubernetes replay source "${sourceId}".`);
  }
  if (source.kind === "unsupported") {
    throw new DomainError(
      "REQUEST_INVALID",
      `Kubernetes replay source "${source.sourceId}" is unsupported and cannot be reviewed.`,
    );
  }
  return source;
}
