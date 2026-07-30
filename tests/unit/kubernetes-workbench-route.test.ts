import { describe, expect, it } from "vitest";

import KubernetesWorkbenchPage, { metadata } from "../../app/workbench/kubernetes/page";

describe("Kubernetes workbench route", () => {
  it("publishes the dedicated public-replay workbench metadata", () => {
    expect(metadata.title).toBe("ChangeSafe Kubernetes Workbench — Public Replay");
    expect(metadata.description).toContain("No cluster is contacted");
    expect(KubernetesWorkbenchPage).toBeTypeOf("function");
  });
});
