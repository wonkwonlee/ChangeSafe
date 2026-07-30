import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SelfHostedWorkbenchPage, {
  metadata,
} from "../../app/workbench/self-hosted/page";

describe("/workbench/self-hosted route", () => {
  it("renders a separate, disabled-until-configured authenticated surface", () => {
    const previous = process.env.CHANGESAFE_SELF_HOSTED_BASE_URL;
    delete process.env.CHANGESAFE_SELF_HOSTED_BASE_URL;
    try {
      const markup = renderToStaticMarkup(createElement(SelfHostedWorkbenchPage));
      expect(markup).toContain('aria-label="Runtime navigation"');
      expect(markup).toContain("Legacy local");
      expect(markup).toContain("Public replay");
      expect(markup).toContain("Authenticated self-hosted");
      expect(markup).toContain("Self-hosted review is not configured");
      expect(markup).toContain("Kubernetes offline artifact");
      expect(markup).toContain("Kubernetes unsupported");
      expect(markup).toContain("never executes infrastructure");
      expect(metadata.title).toBe(
        "ChangeSafe Workbench — Authenticated Self-Hosted",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.CHANGESAFE_SELF_HOSTED_BASE_URL;
      } else {
        process.env.CHANGESAFE_SELF_HOSTED_BASE_URL = previous;
      }
    }
  });

  it("has no client token, authorization, or editable server URL surface", () => {
    const pageSource = readFileSync("app/workbench/self-hosted/page.tsx", "utf8");
    const transportSource = readFileSync(
      "features/reviews/selfHostedReviewTransport.ts",
      "utf8",
    );
    const uiSource = readFileSync(
      "components/SelfHostedReviewWorkbench.tsx",
      "utf8",
    );

    expect(pageSource).toContain("CHANGESAFE_SELF_HOSTED_BASE_URL");
    expect(pageSource).not.toContain("NEXT_PUBLIC");
    expect(transportSource).not.toMatch(/authorization|bearer/i);
    expect(uiSource).not.toMatch(/type=["'](?:url|password)["']/);
    expect(uiSource).not.toContain("localStorage");
    expect(uiSource).not.toContain("sessionStorage");
  });
});
