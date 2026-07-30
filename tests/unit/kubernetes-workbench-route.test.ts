import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
