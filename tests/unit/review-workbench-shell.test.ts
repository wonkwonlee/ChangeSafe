import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ReviewWorkbenchShell reads the ?scenario deep-link via next/navigation's
// client hooks. Outside a real Next.js app router (as here, rendering
// straight to static markup) those hooks throw without this mock.
vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ replace: () => {} }),
}));

import { ReviewWorkbenchShell } from "../../components/ReviewWorkbenchShell";
import { NETWORK_REVIEW_EXAMPLES } from "@/features/domains/network/examples";
import { loadDomainCoverageCatalog } from "@/features/domains/registry";
import { NETWORK_SCENARIOS } from "../../scenarios";

async function renderShell() {
  const coverageCatalog = await loadDomainCoverageCatalog("network");
  return renderToStaticMarkup(
    createElement(ReviewWorkbenchShell, { coverageCatalog }),
  );
}

describe("ReviewWorkbenchShell", () => {
  it("renders every bundled Network replay as an accessible interactive selector", async () => {
    const markup = await renderShell();
    expect(markup).toContain('<main aria-busy="false" aria-label="Review canvas"');
    expect(markup).toContain('<aside aria-label="Review context"');
    expect(markup).toContain('<aside aria-label="Review authority"');
    expect(markup).toContain("Run replay");
    expect(markup).toContain('<ul class="mt-4 grid gap-2" role="list" aria-label="Bundled Network examples">');
    expect((markup.match(/aria-pressed=/g) ?? [])).toHaveLength(NETWORK_REVIEW_EXAMPLES.length);
    for (const example of NETWORK_REVIEW_EXAMPLES) expect(markup).toContain(example.label);
    expect(markup).toContain("Registered metadata");
    expect(markup).toContain("Loaded deterministic coverage");
    expect(markup).toContain("MGMT_REACHABILITY");
    expect(markup).toContain("loaded · not yet evaluated");
    expect(markup).toContain("captured-replay");
    expect(markup).toContain("Accessible topology tables");
    expect(markup).toContain("<caption>Network nodes</caption>");
    expect(markup).toContain("<caption>Network links</caption>");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(">Network</span>");
  });

  it("announces only trusted replay lifecycle copy and marks an active replay busy", async () => {
    const markup = await renderShell();
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain("Replay is ready to evaluate.");
    expect(markup).toContain('<main aria-busy="false" aria-label="Review canvas"');

    const source = readFileSync("components/ReviewWorkbenchShell.tsx", "utf8");
    expect(source).toContain('<main aria-busy={workflow.phase === "ANALYZING"} aria-label="Review canvas"');
    expect(source).not.toContain('<button aria-busy={workflow.phase === "ANALYZING"}');
    expect(source).toContain("Replay could not be evaluated. Choose Run replay to try again.");
    expect(source).not.toContain("<p aria-atomic=\"true\" aria-live=\"polite\" className=\"sr-only\" role=\"status\">\n                <StateValue");
  });

  it("shows bundled input truth while keeping unevaluated output distinct from declared expectations", async () => {
    const scenario = NETWORK_SCENARIOS[0];
    if (!scenario) throw new Error("Expected a bundled scenario");
    const markup = await renderShell();
    expect(markup).toContain(scenario.inputId);
    const alerts = (scenario.input as { alerts: { evidenceId: string }[] }).alerts;
    expect(markup).toContain(alerts[0]?.evidenceId);
    expect(markup).toContain("No evaluated proposal is available yet.");
    expect(markup).toContain("Findings appear only after replay evaluation.");
    expect(markup).toContain("Not evaluated");
    expect(markup).not.toContain("Declared risk expectation");
    expect(markup).not.toContain("Declared approval expectation");
  });

  it("uses only the public replay transport and exposes no decision, simulation, or receipt action", () => {
    const source = readFileSync("components/ReviewWorkbenchShell.tsx", "utf8");
    expect(source).toContain('from "@/features/reviews/publicReplayTransport"');
    expect(source).toContain("publicReplayTransport");
    expect(source).not.toMatch(/\b(?:approve|reject|recordReceipt|completeSimulation)\s*\(/);
    expect(source).not.toContain("useNetworkWorkflow");
    expect(source).toContain("BLOCKED by deterministic findings");
    expect(source).toContain("no durable decision or signed receipt");
  });
});
