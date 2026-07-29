import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewWorkbenchShell } from "../../components/ReviewWorkbenchShell";

function renderShell(): string {
  return renderToStaticMarkup(createElement(ReviewWorkbenchShell));
}

describe("ReviewWorkbenchShell", () => {
  it("renders a public-replay workbench with accessible navigation and three named regions", () => {
    const markup = renderShell();

    expect(markup).toContain('<nav aria-label="Product navigation"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('<aside aria-label="Review context"');
    expect(markup).toContain('<main aria-label="Review canvas"');
    expect(markup).toContain('<aside aria-label="Review authority"');
    expect(markup.match(/aria-label="Review (?:context|canvas|authority)"/g)).toHaveLength(3);
  });

  it("makes every Authority Spine claim and the execution boundary visible", () => {
    const markup = renderShell();

    for (const claim of [
      "Input",
      "Proposal",
      "Gate",
      "Human",
      "Effect proof",
      "Record",
      "Execution outside ChangeSafe",
    ]) {
      expect(markup).toContain(`>${claim}<`);
    }

    expect(markup).toContain("ChangeSafe never executes infrastructure changes");
  });

  it("states public replay capabilities and limitations without decision or execution controls", () => {
    const markup = renderShell();

    expect(markup).toContain("Public replay");
    expect(markup).toContain("Bundled, validated fixture");
    expect(markup).toContain("Ephemeral session");
    expect(markup).toContain("No durable review record");
    expect(markup).toContain("No signed or ledger-backed receipt");
    expect(markup).not.toMatch(/<(?:button|form|input|select|textarea)\b/);
    expect(markup).not.toMatch(/>\s*(?:Approve|Reject|Execute)\s*</i);
  });
});
