import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WorkbenchPage, { metadata } from "../../app/workbench/page";

describe("/workbench route", () => {
  it("renders the interactive public-replay workbench with honest metadata", () => {
    const markup = renderToStaticMarkup(createElement(WorkbenchPage));

    expect(markup).toContain('<nav aria-label="Product navigation"');
    expect(markup).toContain('<main aria-label="Review canvas"');
    expect(markup).toContain('<aside aria-label="Review authority"');
    expect(markup).toContain("Public replay");
    expect(metadata.title).toBe("ChangeSafe Workbench — Public Replay");
    expect(metadata.description).toContain("ephemeral");
    expect(metadata.description).toContain("never executes infrastructure changes");
  });
});
