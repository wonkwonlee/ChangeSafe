import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// TerraformWorkbenchShell reads the ?scenario deep-link via next/navigation's
// client hooks. Outside a real Next.js app router (as here, rendering
// straight to static markup) those hooks throw without this mock.
vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ replace: () => {} }),
}));

import TerraformWorkbenchPage, { metadata } from "../../app/workbench/terraform/page";

describe("/workbench/terraform route", () => {
  it("renders the dedicated Terraform public external-diff workbench", async () => {
    const markup = renderToStaticMarkup(await TerraformWorkbenchPage());
    expect(markup).toContain("Terraform external diff");
    expect(markup).toContain('aria-label="Terraform review canvas"');
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/workbench/kubernetes"');
    expect(markup).toContain('aria-current="page"');
    expect(metadata.title).toBe("ChangeSafe Terraform Workbench — Public Replay");
    expect(metadata.description).toContain("Terraform is never run");
  });
});
