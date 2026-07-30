import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// KubernetesWorkbenchShell reads the ?scenario deep-link via next/navigation's
// client hooks. Outside a real Next.js app router (as here, rendering
// straight to static markup) those hooks throw without this mock.
vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ replace: () => {} }),
}));

import KubernetesWorkbenchPage, { metadata } from "../../app/workbench/kubernetes/page";

describe("Kubernetes workbench route", () => {
  it("publishes the dedicated public-replay workbench metadata", () => {
    expect(metadata.title).toBe("ChangeSafe Kubernetes Workbench — Public Replay");
    expect(metadata.description).toContain("No cluster is contacted");
    expect(KubernetesWorkbenchPage).toBeTypeOf("function");
  });

  it("keeps product navigation available from the Kubernetes workbench", async () => {
    const markup = renderToStaticMarkup(await KubernetesWorkbenchPage());
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/workbench/terraform"');
    expect(markup).toContain('aria-current="page"');
  });
});
