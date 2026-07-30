import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ReviewWorkbenchShell (network) reads the ?scenario deep-link via
// next/navigation's client hooks, which throw outside a mounted Next.js
// app router — as here, rendering straight to static markup.
vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ replace: () => {} }),
}));

import { KubernetesWorkbenchShell } from "@/components/KubernetesWorkbenchShell";
import { ReviewWorkbenchShell } from "@/components/ReviewWorkbenchShell";
import { TerraformWorkbenchShell } from "@/components/TerraformWorkbenchShell";
import { loadDomainCoverageCatalog } from "@/features/domains/registry";

function headingRanks(markup: string): readonly number[] {
  return [...markup.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
}

function assertValidHeadingOutline(markup: string): void {
  const ranks = headingRanks(markup);
  expect(ranks.filter((rank) => rank === 1)).toHaveLength(1);
  expect(ranks[0]).toBe(1);

  for (let index = 1; index < ranks.length; index += 1) {
    const previous = ranks[index - 1];
    const current = ranks[index];
    if (previous === undefined || current === undefined) {
      throw new Error("Expected every rendered heading to have a rank");
    }
    expect(
      current,
      `heading ${index + 1} must not jump from h${previous} to h${current}`,
    ).toBeLessThanOrEqual(previous + 1);
  }
}

describe("public workbench heading outlines", () => {
  it("rejects a skipped heading rank", () => {
    expect(() => assertValidHeadingOutline("<h1>Outcome</h1><h3>Evidence</h3>"))
      .toThrow();
  });

  it.each([
    ["network", ReviewWorkbenchShell],
    ["terraform", TerraformWorkbenchShell],
    ["kubernetes", KubernetesWorkbenchShell],
  ] as const)("renders a single h1 and no rank jumps for %s", async (domainId, Shell) => {
    const coverageCatalog = await loadDomainCoverageCatalog(domainId);
    const markup = renderToStaticMarkup(createElement(Shell, { coverageCatalog }));
    assertValidHeadingOutline(markup);
  });
});
