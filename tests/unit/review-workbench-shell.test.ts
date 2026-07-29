import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewWorkbenchShell } from "../../components/ReviewWorkbenchShell";
import { NETWORK_REVIEW_EXAMPLES } from "@/features/domains/network/examples";
import { SCENARIOS } from "../../scenarios";

describe("ReviewWorkbenchShell", () => {
  it("renders every bundled Network replay as an accessible interactive selector", () => {
    const markup = renderToStaticMarkup(createElement(ReviewWorkbenchShell));
    expect(markup).toContain('<main aria-label="Review canvas"');
    expect(markup).toContain('<aside aria-label="Review context"');
    expect(markup).toContain('<aside aria-label="Review authority"');
    expect(markup).toContain("Run replay");
    expect((markup.match(/aria-pressed=/g) ?? [])).toHaveLength(NETWORK_REVIEW_EXAMPLES.length);
    for (const example of NETWORK_REVIEW_EXAMPLES) expect(markup).toContain(example.label);
  });

  it("shows bundled input truth while keeping unevaluated output distinct from declared expectations", () => {
    const scenario = SCENARIOS[0];
    if (!scenario) throw new Error("Expected a bundled scenario");
    const markup = renderToStaticMarkup(createElement(ReviewWorkbenchShell));
    expect(markup).toContain(scenario.bundle.incidentId);
    expect(markup).toContain(scenario.bundle.alerts[0]?.evidenceId);
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
