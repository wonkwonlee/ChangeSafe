import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TerraformWorkbenchShell } from "../../components/TerraformWorkbenchShell";
import { TERRAFORM_REVIEW_EXAMPLES } from "@/features/domains/terraform/examples";
import { loadDomainCoverageCatalog } from "@/features/domains/registry";

async function renderShell() {
  const coverageCatalog = await loadDomainCoverageCatalog("terraform");
  return renderToStaticMarkup(
    createElement(TerraformWorkbenchShell, { coverageCatalog }),
  );
}

describe("TerraformWorkbenchShell", () => {
  it("renders every bundled external-diff replay without declaring an outcome", async () => {
    const markup = await renderShell();
    expect(markup).toContain('<main aria-busy="false" aria-label="Terraform review canvas"');
    expect(markup).toContain('<aside aria-label="Terraform review context"');
    expect(markup).toContain("No evaluated proposal is available yet.");
    expect(markup).toContain("Policy, reversibility, and untrusted-context evidence appear only after replay evaluation.");
    expect(markup).toContain("Not evaluated");
    expect((markup.match(/aria-pressed=/g) ?? [])).toHaveLength(TERRAFORM_REVIEW_EXAMPLES.length);
    for (const example of TERRAFORM_REVIEW_EXAMPLES) expect(markup).toContain(example.label);
    expect(markup).toContain("terraform-defaults");
    expect(markup).toContain("Explicit policy skips");
    expect(markup).toContain("ROLLBACK_COMPLETE");
    expect(markup).toContain("Replacement: REVERSIBILITY");
  });

  it("states the external-diff and no-execution boundaries", async () => {
    const markup = await renderShell();
    expect(markup).toContain("Terraform is not run");
    expect(markup).toContain("simulation is unavailable");
    expect(markup).toContain("ChangeSafe never runs Terraform");
    expect(markup).toContain("Module, provider resource type, address, and before/after values");
  });

  it("uses only public replay and has no decision, simulation, or receipt action", () => {
    const source = readFileSync("components/TerraformWorkbenchShell.tsx", "utf8");
    expect(source).toContain('from "@/features/reviews/publicReplayTransport"');
    expect(source).not.toMatch(/\b(?:approve|reject|recordReceipt|completeSimulation)\s*\(/);
    expect(source).not.toContain("useNetworkWorkflow");
    expect(source).toContain('aria-busy={workflow.phase === "ANALYZING"}');
  });
});
