import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createSelectorRelationshipResolver,
  KubernetesWorkbenchShell,
  selectorRelationshipCandidates,
  selectorRelationships,
} from "../../components/KubernetesWorkbenchShell";
import { KUBERNETES_REVIEW_EXAMPLES } from "@/features/domains/kubernetes/examples";
import { searchAndPageOfflineCollection } from "@/features/domains/presentation-limit";
import { loadDomainCoverageCatalog } from "@/features/domains/registry";
import {
  KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
} from "@/features/domains/kubernetes/fixtures";
import { KubernetesSnapshotSchema } from "@changesafe/domain-kubernetes/offline";

async function renderShell() {
  const coverageCatalog = await loadDomainCoverageCatalog("kubernetes");
  return renderToStaticMarkup(
    createElement(KubernetesWorkbenchShell, { coverageCatalog }),
  );
}

describe("KubernetesWorkbenchShell", () => {
  it("renders every supported offline replay without declaring an outcome", async () => {
    const markup = await renderShell();
    expect(markup).toContain('<main aria-busy="false" aria-label="Kubernetes review canvas"');
    expect(markup).toContain('<aside aria-label="Kubernetes review context"');
    expect(markup).toContain("No evaluated proposal is available yet.");
    expect(markup).toContain("Policy evidence appears only after replay evaluation.");
    expect(markup).toContain("Not evaluated");
    expect((markup.match(/aria-pressed=/g) ?? [])).toHaveLength(KUBERNETES_REVIEW_EXAMPLES.length);
    for (const example of KUBERNETES_REVIEW_EXAMPLES) expect(markup).toContain(example.label);
    expect(markup).toContain("K8S_PRIVILEGE_ESCALATION");
    expect(markup).toContain("authored-synthetic");
    expect(markup).toContain("never contacts a Kubernetes API");
  });

  it("states the offline, no-contact, no-apply, decision-free boundaries", async () => {
    const markup = await renderShell();
    expect(markup).toContain("No cluster is contacted");
    expect(markup).toContain("no manifest is applied");
    expect(markup).toContain("Unavailable and not run");
    expect(markup).toContain("no validated simulation result");
    expect(markup).toContain("never contacts this cluster or applies infrastructure changes");
  });

  it("uses only public replay and has no decision, simulation, or receipt action", () => {
    const source = readFileSync("components/KubernetesWorkbenchShell.tsx", "utf8");
    expect(source).toContain('from "@/features/reviews/publicReplayTransport"');
    expect(source).not.toMatch(/\b(?:approve|reject|recordReceipt|completeSimulation)\s*\(/);
    expect(source).not.toContain("useNetworkWorkflow");
    expect(source).toContain('aria-busy={workflow.phase === "ANALYZING"}');
  });

  it("matches Service selectors against workload Pod-template labels, not workload metadata labels", () => {
    const workload = KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.resources.find(
      (resource) => resource.identity.kind === "Deployment",
    );
    if (!workload || !("podLabels" in workload.spec)) {
      throw new Error("The public Kubernetes fixture must include a Deployment workload");
    }

    const divergentSnapshot = KubernetesSnapshotSchema.parse({
      ...KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
      resources: KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.resources.map((resource) =>
        resource.resourceId === workload.resourceId
          ? {
            ...resource,
            metadata: { ...resource.metadata, labels: { app: "web" } },
            spec: { ...resource.spec, podLabels: { app: "different-workload" } },
          }
          : resource,
      ),
    });

    const webService = selectorRelationships(
      divergentSnapshot,
      selectorRelationshipCandidates(divergentSnapshot),
    ).find(
      ({ service }) => service.identity.name === "web",
    );
    expect(webService?.matches).toEqual([]);
  });

  it("indexes a schema-large workload set and materializes matches only for visible or searched Services", () => {
    const serviceTemplate = KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.resources.find(
      (resource) => resource.identity.kind === "Service",
    );
    const workloadTemplate = KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.resources.find(
      (resource) => resource.identity.kind === "Deployment",
    );
    if (!serviceTemplate || serviceTemplate.identity.kind !== "Service") {
      throw new Error("The public fixture must include a Service");
    }
    if (!workloadTemplate || workloadTemplate.identity.kind !== "Deployment") {
      throw new Error("The public fixture must include a Deployment");
    }

    const services = Array.from({ length: 120 }, (_, index) => ({
      ...serviceTemplate,
      resourceId: `res-${index.toString(16).padStart(16, "0")}`,
      evidenceId: `ev-boundary-service-${index}`,
      identity: {
        ...serviceTemplate.identity,
        name: `boundary-service-${index.toString().padStart(3, "0")}`,
      },
      spec: {
        ...serviceTemplate.spec,
        selector: { group: "boundary-worker" },
      },
    }));
    const workloads = Array.from({ length: 240 }, (_, index) => ({
      ...workloadTemplate,
      resourceId: `res-${(index + 1_000).toString(16).padStart(16, "0")}`,
      evidenceId: `ev-boundary-workload-${index}`,
      identity: {
        ...workloadTemplate.identity,
        name: `boundary-workload-${index.toString().padStart(3, "0")}`,
      },
      spec: {
        ...workloadTemplate.spec,
        podLabels: { group: "boundary-worker" },
      },
    }));
    const snapshot = KubernetesSnapshotSchema.parse({
      ...KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
      resources: [...services, ...workloads],
    });
    const candidates = selectorRelationshipCandidates(snapshot);
    const resolver = createSelectorRelationshipResolver(snapshot);
    const firstPage = searchAndPageOfflineCollection(
      candidates,
      "",
      ({ service, selector }) =>
        `${service.identity.namespace}/${service.identity.name} ${JSON.stringify(selector)}`,
      0,
    );
    const firstVisibleRelationships = firstPage.items.map(resolver);

    expect(candidates).toHaveLength(120);
    expect(firstVisibleRelationships).toHaveLength(8);
    expect(firstVisibleRelationships[0]?.matches).toHaveLength(240);

    const searchedPage = searchAndPageOfflineCollection(
      candidates,
      "boundary-service-119",
      ({ service, selector }) =>
        `${service.identity.namespace}/${service.identity.name} ${JSON.stringify(selector)}`,
      0,
    );
    expect(searchedPage.items).toHaveLength(1);
    expect(searchedPage.items.map(resolver)[0]?.matches).toHaveLength(240);
  });
});
