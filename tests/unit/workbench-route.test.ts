import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ReviewWorkbenchShell reads the ?scenario deep-link via next/navigation's
// client hooks. Outside a real Next.js app router (as here, rendering
// straight to static markup) those hooks throw without this mock.
vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ replace: () => {} }),
}));

import WorkbenchPage, { metadata } from "../../app/page";

describe("default / route", () => {
  it("renders the interactive public-replay workbench with honest metadata", async () => {
    const markup = renderToStaticMarkup(await WorkbenchPage());

    expect(markup).toContain('<nav aria-label="Product navigation"');
    expect(markup).toMatch(
      /<main\b(?=[^>]*\baria-label="Review canvas")(?=[^>]*\baria-busy="false")[^>]*>/,
    );
    expect(markup).toContain('<aside aria-label="Review authority"');
    expect(markup).toContain("Public replay");
    expect(metadata.title).toBe("ChangeSafe Workbench — Public Replay");
    expect(metadata.description).toContain("ephemeral");
    expect(metadata.description).toContain("never executes infrastructure changes");
  });
});
