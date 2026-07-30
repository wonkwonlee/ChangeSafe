import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TerraformWorkbenchPage, { metadata } from "../../app/workbench/terraform/page";

describe("/workbench/terraform route", () => {
  it("renders the dedicated Terraform public external-diff workbench", async () => {
    const markup = renderToStaticMarkup(await TerraformWorkbenchPage());
    expect(markup).toContain("Terraform external diff");
    expect(markup).toContain('aria-label="Terraform review canvas"');
    expect(metadata.title).toBe("ChangeSafe Terraform Workbench — Public Replay");
    expect(metadata.description).toContain("Terraform is never run");
  });
});
