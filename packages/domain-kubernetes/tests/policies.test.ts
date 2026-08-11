import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY_PACK,
  PolicyFindingSchema,
  evaluatePolicies,
  policyOrder,
  type ChangeOperation,
  type ChangeProposal,
  type PolicyContext,
  type PolicyEvaluator,
  type PolicyFinding,
} from "@changesafe/core";

import {
  evaluateMutableImage,
  evaluatePrivilegeEscalation,
  evaluateProtectedResource,
  evaluateServiceSelector,
  evaluateWorkloadAvailability,
  kubernetesDomain,
  normalizeSnapshot,
} from "../src/index";
import type {
  KubernetesDaemonSetResource,
  KubernetesDeploymentResource,
  KubernetesResource,
  KubernetesServiceResource,
  KubernetesSnapshot,
  KubernetesState,
} from "../src/schemas";

const snapshot = normalizeSnapshot({
  snapshotVersion: "changesafe-kubernetes-snapshot/v1",
  snapshotId: "snapshot-policies",
  evidenceId: "ev-snapshot-policies",
  provenance: {
    source: "authored",
    collectedAtUtc: "2026-07-28T00:00:00.000Z",
    contextFingerprint: "context-policies",
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
        strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 0 } },
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

const daemonSnapshot = normalizeSnapshot({
  ...snapshot,
  snapshotId: "snapshot-daemon-policy",
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      metadata: { name: "node-agent", namespace: "demo" },
      spec: {
        template: {
          metadata: { labels: { app: "node-agent" } },
          spec: {
            containers: [
              {
                name: "node-agent",
                image: "registry.example.invalid/node-agent:v1",
                securityContext: { allowPrivilegeEscalation: false },
              },
            ],
          },
        },
      },
    },
  ],
});

const deployment = snapshot.resources.find(
  (resource): resource is KubernetesDeploymentResource =>
    resource.identity.kind === "Deployment",
)!;
const service = snapshot.resources.find(
  (resource): resource is KubernetesServiceResource =>
    resource.identity.kind === "Service",
)!;
const daemonSet = daemonSnapshot.resources.find(
  (resource): resource is KubernetesDaemonSetResource =>
    resource.identity.kind === "DaemonSet",
)!;
const deploymentPath = `/resources/${deployment.resourceId}`;
const servicePath = `/resources/${service.resourceId}`;

function withResources(
  input: KubernetesSnapshot,
  ...resources: KubernetesResource[]
): KubernetesSnapshot {
  const replacements = new Map(resources.map((resource) => [resource.resourceId, resource]));
  return {
    ...input,
    resources: input.resources.map((resource) => replacements.get(resource.resourceId) ?? resource),
  };
}

function replacement(
  current: KubernetesResource = deployment,
  change: Record<string, unknown> = {},
): ChangeOperation {
  return {
    op: "replace",
    path: `/resources/${current.resourceId}`,
    value: { ...current, ...change },
    reason: "Exercise one Kubernetes safety policy.",
    evidenceIds: [current.evidenceId],
  } as ChangeOperation;
}

function proposal(
  input: KubernetesSnapshot,
  ...operations: ChangeOperation[]
): ChangeProposal {
  const byPath = new Map(
    input.resources.map((resource) => [`/resources/${resource.resourceId}`, resource]),
  );
  return {
    proposalId: "proposal-policies",
    summary: "Evaluate Kubernetes safety policy behavior.",
    diagnosis: {
      likelyCause: "A declarative update needs deterministic review.",
      confidence: 0,
      evidenceIds: [input.evidenceId],
      assumptions: [],
    },
    operations,
    rollbackOperations: operations
      .map((operation) => ({ ...operation, value: byPath.get(operation.path)! }))
      .reverse(),
    verificationSteps: [
      {
        kind: "precondition",
        description: "Confirm the offline snapshot is current.",
        evidenceIds: [input.evidenceId],
      },
      {
        kind: "postcheck",
        description: "Confirm the human-applied change is healthy.",
        evidenceIds: [input.evidenceId],
      },
    ],
  } as ChangeProposal;
}

function finding(
  operations: ChangeOperation[],
  policyId: string,
  input: KubernetesSnapshot = snapshot,
): PolicyFinding {
  const result = evaluatePolicies(kubernetesDomain, input, proposal(input, ...operations));
  const policy = result.findings.find((candidate) => candidate.policyId === policyId);
  if (!policy) throw new Error(`missing finding ${policyId}`);
  return policy;
}

const passFindings = {
  privilege: {
    policyId: "K8S_PRIVILEGE_ESCALATION",
    status: "PASS",
    title: "No privilege escalation introduced",
    explanation:
      "No proposed workload newly enables a modeled privileged setting or capability outside the Baseline allowlist.",
    affectedResources: [],
    remediation: null,
  },
  availability: {
    policyId: "K8S_WORKLOAD_AVAILABILITY",
    status: "PASS",
    title: "Modeled workload availability is preserved",
    explanation:
      "No existing Deployment or StatefulSet is reduced to zero, changed to Recreate, or given a wider modeled disruption budget.",
    affectedResources: [],
    remediation: null,
  },
  selector: {
    policyId: "K8S_SERVICE_SELECTOR",
    status: "PASS",
    title: "Service selectors remain satisfiable",
    explanation:
      "Every selector-bearing, non-ExternalName Service that matched a supported workload before the change still has a match.",
    affectedResources: [],
    remediation: null,
  },
  protected: {
    policyId: "K8S_PROTECTED_RESOURCE",
    status: "PASS",
    title: "Protected resources remain unchanged",
    explanation:
      "No existing resource annotated changesafe.dev/protected: true changes its normalized spec or loses protection.",
    affectedResources: [],
    remediation: null,
  },
  image: {
    policyId: "K8S_MUTABLE_IMAGE",
    status: "PASS",
    title: "No mutable image is introduced",
    explanation:
      "Every newly introduced workload image is digest-pinned or carries a non-latest tag.",
    affectedResources: [],
    remediation: null,
  },
} satisfies Record<string, PolicyFinding>;

const privilegeBlock = (detail: string): PolicyFinding => ({
  policyId: "K8S_PRIVILEGE_ESCALATION",
  status: "BLOCK",
  title: "Change introduces privileged workload settings",
  explanation: `${deploymentPath} newly enables ${detail}. Privileged workload settings cannot be approved.`,
  affectedResources: [deploymentPath],
  remediation:
    "Remove the newly privileged setting or use a separately reviewed, least-privilege workload design.",
});

describe("Kubernetes domain policy publication and risk", () => {
  it("blocks forward remove operations even when called through core", () => {
    const removal = { ...replacement(deployment), op: "remove" as const };
    const forward = proposal(snapshot, removal);
    const result = evaluatePolicies(kubernetesDomain, snapshot, {
      ...forward,
      operations: [removal],
    });
    expect(result.findings.some((finding) => finding.status === "BLOCK")).toBe(true);
  });
  it("publishes the complete structural, domain, and universal policy order", () => {
    expect(policyOrder(kubernetesDomain)).toEqual([
      "PATCH_SCHEMA",
      "K8S_PRIVILEGE_ESCALATION",
      "K8S_WORKLOAD_AVAILABILITY",
      "K8S_SERVICE_SELECTOR",
      "K8S_PROTECTED_RESOURCE",
      "K8S_MUTABLE_IMAGE",
      "BLAST_RADIUS",
      "ROLLBACK_COMPLETE",
      "VERIFICATION_REQUIRED",
      "UNTRUSTED_INSTRUCTION",
    ]);
  });

  it("derives HIGH only through core when two Kubernetes policies warn", () => {
    const evaluation = evaluatePolicies(
      kubernetesDomain,
      snapshot,
      proposal(
        snapshot,
        replacement(deployment, {
          spec: {
            ...deployment.spec,
            replicas: 1,
            containers: [{ name: "web", image: "registry.example.invalid/web:latest" }],
          },
        }),
      ),
    );
    expect(evaluation.riskLevel).toBe("HIGH");
  });
});

describe("K8S_PRIVILEGE_ESCALATION", () => {
  it.each([
    [
      "privileged container",
      { containers: [{ name: "web", image: "registry.example.invalid/web:v1", security: { privileged: true } }] },
      "web:privileged",
    ],
    ["host networking", { hostNetwork: true }, "hostNetwork"],
    ["host process namespace", { hostPID: true }, "hostPID"],
    ["host IPC namespace", { hostIPC: true }, "hostIPC"],
    ["hostPath volume", { hasHostPath: true }, "hasHostPath"],
    ["pod-level root UID", { podRunAsUser: 0 }, "pod:runAsUser=0"],
    [
      "privileged init container",
      { initContainers: [{ name: "setup", image: "registry.example.invalid/setup:v1", security: { privileged: true, allowPrivilegeEscalation: false } }] },
      "setup:privileged",
    ],
    [
      "privileged ephemeral container",
      { ephemeralContainers: [{ name: "debug", image: "registry.example.invalid/debug:v1", security: { privileged: true, allowPrivilegeEscalation: false } }] },
      "debug:privileged",
    ],
    [
      "privilege escalation",
      {
        containers: [
          {
            name: "web",
            image: "registry.example.invalid/web:v1",
            security: { allowPrivilegeEscalation: true },
          },
        ],
      },
      "web:allowPrivilegeEscalation",
    ],
    [
      "root UID",
      {
        containers: [
          {
            name: "web",
            image: "registry.example.invalid/web:v1",
            security: { runAsUser: 0 },
          },
        ],
      },
      "web:runAsUser=0",
    ],
    [
      "capability outside the Baseline allowlist",
      {
        containers: [
          {
            name: "web",
            image: "registry.example.invalid/web:v1",
            security: { addedCapabilities: ["SYS_ADMIN"] },
          },
        ],
      },
      "web:capability=SYS_ADMIN",
    ],
    [
      "ambiguous security for a new container",
      {
        containers: [
          { name: "web", image: "registry.example.invalid/web:v1" },
          { name: "sidecar", image: "registry.example.invalid/sidecar:v1" },
        ],
      },
      "sidecar:allowPrivilegeEscalation=ambiguous",
    ],
  ])("blocks newly introduced %s", (_case, specChange, detail) => {
    const result = finding(
      [replacement(deployment, { spec: { ...deployment.spec, ...specChange } })],
      "K8S_PRIVILEGE_ESCALATION",
    );
    expect(result).toEqual(privilegeBlock(detail));
  });

  it("passes an unchanged security posture", () => {
    expect(finding([replacement()], "K8S_PRIVILEGE_ESCALATION")).toEqual(
      passFindings.privilege,
    );
  });
});

describe("K8S_WORKLOAD_AVAILABILITY", () => {
  it.each([
    [
      "zero replicas",
      { ...deployment.spec, replicas: 0 },
      `${deploymentPath} reduces an existing workload to zero replicas.`,
    ],
    [
      "Recreate strategy",
      { ...deployment.spec, strategy: "Recreate" },
      `${deploymentPath} changes RollingUpdate strategy to Recreate.`,
    ],
  ])("blocks an existing Deployment changed to %s", (_case, spec, explanation) => {
    expect(
      finding(
        [replacement(deployment, { spec })],
        "K8S_WORKLOAD_AVAILABILITY",
      ),
    ).toEqual({
      policyId: "K8S_WORKLOAD_AVAILABILITY",
      status: "BLOCK",
      title: "Change breaks modeled workload availability",
      explanation,
      affectedResources: [deploymentPath],
      remediation:
        "Keep at least one replica and preserve RollingUpdate strategy for existing workloads.",
    });
  });

  it.each([
    [
      "Deployment to DaemonSet",
      {
        ...deployment,
        identity: {
          ...deployment.identity,
          kind: "DaemonSet" as const,
        },
        spec: {
          podLabels: deployment.spec.podLabels,
          containers: deployment.spec.containers,
          hostNetwork: deployment.spec.hostNetwork,
          hostPID: deployment.spec.hostPID,
          hostIPC: deployment.spec.hostIPC,
          hasHostPath: deployment.spec.hasHostPath,
        },
      },
    ],
  ])("blocks a supported kind change from %s", (_case, after) => {
    const operation = replacement(deployment, {
      identity: after.identity,
      spec: after.spec,
    });
    const kindChangeAdapter = {
      ...kubernetesDomain,
      applyOperations(state: KubernetesState) {
        return {
          nextState: {
            resources: {
              ...state.resources,
              [deployment.resourceId]: after,
            },
          },
          diff: [],
        };
      },
    };
    const context: PolicyContext<KubernetesSnapshot, KubernetesState> = {
      input: snapshot,
      proposal: proposal(snapshot, operation),
      adapter: kindChangeAdapter,
      pack: DEFAULT_POLICY_PACK,
    };

    expect(
      evaluateWorkloadAvailability(context),
    ).toEqual({
      policyId: "K8S_WORKLOAD_AVAILABILITY",
      status: "BLOCK",
      title: "Change breaks modeled workload availability",
      explanation: `${deploymentPath} changes a supported workload into a different resource kind.`,
      affectedResources: [deploymentPath],
      remediation:
        "Keep at least one replica and preserve RollingUpdate strategy for existing workloads.",
    });
  });

  it("warns when replicas are reduced without taking the workload to zero", () => {
    expect(
      finding(
        [replacement(deployment, { spec: { ...deployment.spec, replicas: 1 } })],
        "K8S_WORKLOAD_AVAILABILITY",
      ),
    ).toEqual({
      policyId: "K8S_WORKLOAD_AVAILABILITY",
      status: "WARN",
      title: "Change reduces modeled workload availability",
      explanation: `${deploymentPath} reduces replicas from 2 to 1.`,
      affectedResources: [deploymentPath],
      remediation:
        "Confirm the reduced capacity and disruption budget are safe for the planned window.",
    });
  });

  it.each([
    ["integer increase", 8, 1, 2, "WARN"],
    ["integer decrease", 8, 2, 1, "PASS"],
    ["equal percentage", 8, "25%", "25%", "PASS"],
    ["mixed equivalent integer to percentage", 10, 2, "25%", "PASS"],
    ["mixed increase percentage to integer", 10, "25%", 3, "WARN"],
    ["mixed decrease percentage to integer", 10, "30%", 2, "PASS"],
    ["omitted default to equal integer", 8, undefined, 2, "PASS"],
    ["equal integer to omitted default", 8, 2, undefined, "PASS"],
    ["omitted default to rounded-equivalent percentage", 8, undefined, "30%", "PASS"],
    ["omitted default to larger effective percentage", 8, undefined, "38%", "WARN"],
    ["integer values capped by replicas", 8, 10, 20, "PASS"],
  ] as const)(
    "compares effective maxUnavailable capacity for %s",
    (_case, replicas, beforeMaxUnavailable, afterMaxUnavailable, status) => {
      const beforeDeployment = {
        ...deployment,
        spec: {
          ...deployment.spec,
          replicas,
          maxUnavailable: beforeMaxUnavailable,
        },
      };
      const input = withResources(snapshot, beforeDeployment);
      const operation = replacement(beforeDeployment, {
        spec: {
          ...beforeDeployment.spec,
          maxUnavailable: afterMaxUnavailable,
        },
      });
      const result = finding([operation], "K8S_WORKLOAD_AVAILABILITY", input);

      expect(result).toEqual(
        status === "WARN"
          ? {
              policyId: "K8S_WORKLOAD_AVAILABILITY",
              status: "WARN",
              title: "Change reduces modeled workload availability",
              explanation: `${deploymentPath} increases maxUnavailable.`,
              affectedResources: [deploymentPath],
              remediation:
                "Confirm the reduced capacity and disruption budget are safe for the planned window.",
            }
          : passFindings.availability,
      );
    },
  );

  it("warns when replica growth increases the effective default maxUnavailable count", () => {
    const beforeDeployment = {
      ...deployment,
      spec: {
        ...deployment.spec,
        replicas: 4,
        maxUnavailable: undefined,
      },
    };
    const input = withResources(snapshot, beforeDeployment);
    expect(
      finding(
        [
          replacement(beforeDeployment, {
            spec: {
              ...beforeDeployment.spec,
              replicas: 8,
            },
          }),
        ],
        "K8S_WORKLOAD_AVAILABILITY",
        input,
      ),
    ).toEqual({
      policyId: "K8S_WORKLOAD_AVAILABILITY",
      status: "WARN",
      title: "Change reduces modeled workload availability",
      explanation: `${deploymentPath} increases maxUnavailable.`,
      affectedResources: [deploymentPath],
      remediation:
        "Confirm the reduced capacity and disruption budget are safe for the planned window.",
    });
  });

  it("blocks a change from the omitted RollingUpdate default to Recreate", () => {
    const beforeDeployment = {
      ...deployment,
      spec: {
        ...deployment.spec,
        strategy: undefined,
      },
    };
    const input = withResources(snapshot, beforeDeployment);
    expect(
      finding(
        [
          replacement(beforeDeployment, {
            spec: {
              ...beforeDeployment.spec,
              strategy: "Recreate",
            },
          }),
        ],
        "K8S_WORKLOAD_AVAILABILITY",
        input,
      ),
    ).toEqual({
      policyId: "K8S_WORKLOAD_AVAILABILITY",
      status: "BLOCK",
      title: "Change breaks modeled workload availability",
      explanation: `${deploymentPath} changes RollingUpdate strategy to Recreate.`,
      affectedResources: [deploymentPath],
      remediation:
        "Keep at least one replica and preserve RollingUpdate strategy for existing workloads.",
    });
  });

  it("ignores maxUnavailable when an existing Recreate strategy remains Recreate", () => {
    const beforeDeployment = {
      ...deployment,
      spec: {
        ...deployment.spec,
        strategy: "Recreate" as const,
        maxUnavailable: 1,
      },
    };
    const input = withResources(snapshot, beforeDeployment);
    expect(
      finding(
        [
          replacement(beforeDeployment, {
            spec: {
              ...beforeDeployment.spec,
              maxUnavailable: 2,
            },
          }),
        ],
        "K8S_WORKLOAD_AVAILABILITY",
        input,
      ),
    ).toEqual(passFindings.availability);
  });

  it("passes DaemonSet changes because replica availability is not modeled", () => {
    expect(
      finding(
        [
          replacement(daemonSet, {
            spec: {
              ...daemonSet.spec,
              podLabels: { app: "node-agent", tier: "system" },
            },
          }),
        ],
        "K8S_WORKLOAD_AVAILABILITY",
        daemonSnapshot,
      ),
    ).toEqual(passFindings.availability);
  });
});

describe("K8S_SERVICE_SELECTOR", () => {
  it("blocks a Service that loses every matching supported workload", () => {
    expect(
      finding(
        [
          replacement(deployment, {
            spec: { ...deployment.spec, podLabels: { app: "other" } },
          }),
        ],
        "K8S_SERVICE_SELECTOR",
      ),
    ).toEqual({
      policyId: "K8S_SERVICE_SELECTOR",
      status: "BLOCK",
      title: "Service selectors lose every supported workload",
      explanation:
        'Service "web" matched a supported workload before the change and none after it.',
      affectedResources: [servicePath],
      remediation:
        "Preserve at least one matching workload label for every affected Service selector.",
    });
  });

  it.each([
    ["retains a matching workload", service],
    [
      "is selectorless before the change",
      { ...service, spec: { ...service.spec, selector: null } },
    ],
    [
      "is ExternalName before the change",
      { ...service, spec: { type: "ExternalName", selector: null } },
    ],
  ] satisfies [string, KubernetesServiceResource][])(
    "passes when a Service %s",
    (_case, beforeService) => {
      const input = withResources(snapshot, beforeService);
      expect(
        finding(
          [replacement(beforeService)],
          "K8S_SERVICE_SELECTOR",
          input,
        ),
      ).toEqual(passFindings.selector);
    },
  );
});

describe("K8S_PROTECTED_RESOURCE", () => {
  const protectedDeployment = {
    ...deployment,
    metadata: {
      ...deployment.metadata,
      annotations: { "changesafe.dev/protected": "true" },
    },
  };
  const protectedSnapshot = withResources(snapshot, protectedDeployment);

  it.each([
    [
      "normalized spec",
      {
        ...protectedDeployment,
        spec: { ...protectedDeployment.spec, replicas: 1 },
      },
    ],
    [
      "protection annotation",
      {
        ...protectedDeployment,
        metadata: { ...protectedDeployment.metadata, annotations: {} },
      },
    ],
  ])("blocks a change to a protected resource's %s", (_case, after) => {
    expect(
      finding(
        [replacement(protectedDeployment, after)],
        "K8S_PROTECTED_RESOURCE",
        protectedSnapshot,
      ),
    ).toEqual({
      policyId: "K8S_PROTECTED_RESOURCE",
      status: "BLOCK",
      title: "Change alters a protected Kubernetes resource",
      explanation:
        "Protected resource demo/web changes its normalized spec or protection annotation.",
      affectedResources: [deploymentPath],
      remediation:
        "Do not alter protected resources; make the change through a separately reviewed protection-lift process.",
    });
  });

  it.each([
    ["an unprotected resource changes", snapshot, replacement(deployment)],
    [
      "a protected resource is unchanged",
      protectedSnapshot,
      replacement(protectedDeployment),
    ],
  ])("passes when %s", (_case, input, operation) => {
    expect(
      finding([operation], "K8S_PROTECTED_RESOURCE", input),
    ).toEqual(passFindings.protected);
  });
});

describe("K8S_MUTABLE_IMAGE", () => {
  it.each([
    ["untagged image", "registry.example.invalid/web"],
    [":latest image", "registry.example.invalid/web:latest"],
    ["malformed digest", "registry.example.invalid/web@sha256:abc123"],
  ])("warns for an introduced %s", (_case, image) => {
    expect(
      finding(
        [
          replacement(deployment, {
            spec: {
              ...deployment.spec,
              containers: [{ name: "web", image }],
            },
          }),
        ],
        "K8S_MUTABLE_IMAGE",
      ),
    ).toEqual({
      policyId: "K8S_MUTABLE_IMAGE",
      status: "WARN",
      title: "Change introduces mutable container images",
      explanation: `${deploymentPath} introduces ${image}.`,
      affectedResources: [deploymentPath],
      remediation:
        "Use a digest-pinned image (preferred) or a non-latest immutable release tag.",
    });
  });

  it.each([
    ["digest-pinned image", `registry.example.invalid/web@sha256:${"a".repeat(64)}`],
    ["non-latest tagged image", "registry.example.invalid/web:v2"],
  ])("passes for an introduced %s", (_case, image) => {
    expect(
      finding(
        [
          replacement(deployment, {
            spec: {
              ...deployment.spec,
              containers: [{ name: "web", image }],
            },
          }),
        ],
        "K8S_MUTABLE_IMAGE",
      ),
    ).toEqual(passFindings.image);
  });
});

describe("domain policy fail-closed behavior", () => {
  const evaluators = [
    ["K8S_PRIVILEGE_ESCALATION", evaluatePrivilegeEscalation],
    ["K8S_WORKLOAD_AVAILABILITY", evaluateWorkloadAvailability],
    ["K8S_SERVICE_SELECTOR", evaluateServiceSelector],
    ["K8S_PROTECTED_RESOURCE", evaluateProtectedResource],
    ["K8S_MUTABLE_IMAGE", evaluateMutableImage],
  ] as const satisfies readonly [
    string,
    PolicyEvaluator<KubernetesSnapshot, KubernetesState>,
  ][];

  const malformedOperations = [
    ["null operations value", null],
    ["primitive operations value", 42],
    ["null operation", [null]],
    ["primitive operation", [42]],
    ["non-array operations", { path: deploymentPath }],
    ["operation missing path", [{ op: "replace" }]],
    ["operation with non-string path", [{ op: "replace", path: 42 }]],
    ["operation with an invalid string path", [{ op: "replace", path: "" }]],
  ] as const;

  it.each(
    evaluators.flatMap(([policyId, evaluator]) =>
      malformedOperations.map(([malformation, operations]) => [
        policyId,
        malformation,
        evaluator,
        operations,
      ] as const),
    ),
  )(
    "%s returns a typed BLOCK directly for %s",
    (policyId, _malformation, evaluator, operations) => {
      const malformedProposal = {
        ...proposal(snapshot),
        operations,
      } as unknown as ChangeProposal;
      const context: PolicyContext<KubernetesSnapshot, KubernetesState> = {
        input: snapshot,
        proposal: malformedProposal,
        adapter: kubernetesDomain,
        pack: DEFAULT_POLICY_PACK,
      };

      const result = evaluator(context);
      expect(PolicyFindingSchema.parse(result)).toEqual(result);
      expect(result).toEqual({
        policyId,
        status: "BLOCK",
        title: "Post-change Kubernetes state cannot be proven",
        explanation: `${policyId} cannot evaluate the proposed state because the operations fail to apply (Kubernetes operations must be complete resource operation envelopes.). An unevaluated safety policy is blocking.`,
        affectedResources: [],
        remediation:
          "Fix the malformed operation and re-run the deterministic gate.",
      });
    },
  );
});
