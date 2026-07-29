import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KubernetesWorkbenchShell } from "../../components/KubernetesWorkbenchShell";
import { KUBERNETES_REVIEW_EXAMPLES } from "@/features/domains/kubernetes/examples";

describe("KubernetesWorkbenchShell", () => {
  it("renders every supported offline replay without declaring an outcome", () => {
    const markup = renderToStaticMarkup(createElement(KubernetesWorkbenchShell));
    expect(markup).toContain('<main aria-busy="false" aria-label="Kubernetes review canvas"');
    expect(markup).toContain('<aside aria-label="Kubernetes review context"');
    expect(markup).toContain("No evaluated proposal is available yet.");
    expect(markup).toContain("Policy evidence appears only after replay evaluation.");
    expect(markup).toContain("Not evaluated");
    expect((markup.match(/aria-pressed=/g) ?? [])).toHaveLength(KUBERNETES_REVIEW_EXAMPLES.length);
    for (const example of KUBERNETES_REVIEW_EXAMPLES) expect(markup).toContain(example.label);
  });

  it("states the offline, no-contact, no-apply, decision-free boundaries", () => {
    const markup = renderToStaticMarkup(createElement(KubernetesWorkbenchShell));
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
});
