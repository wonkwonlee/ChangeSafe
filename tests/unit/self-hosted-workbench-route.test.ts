import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SelfHostedWorkbenchPage, {
  metadata,
} from "../../app/workbench/self-hosted/page";

describe("/workbench/self-hosted route", () => {
  it("renders a separate, disabled-until-configured authenticated surface", () => {
    const previous = process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL;
    delete process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL;
    try {
      const markup = renderToStaticMarkup(createElement(SelfHostedWorkbenchPage));
      expect(markup).toContain('aria-label="Product navigation"');
      expect(markup).toContain("Network");
      expect(markup).toContain('href="/"');
      expect(markup).not.toContain('href="/workbench"');
      expect(markup).toContain("Authenticated self-hosted");
      expect(markup).toContain("connects to a self-hosted ChangeSafe server that you run");
      expect(markup).toContain("empty by design");
      expect(markup).toContain("Kubernetes offline artifact");
      expect(markup).toContain("Kubernetes unsupported");
      expect(markup).toContain("never executes infrastructure");
      expect(markup).toContain('href="https://github.com/wonkwonlee/ChangeSafe/blob/main/packages/server/README.md"');
      expect(markup).toContain('href="https://github.com/wonkwonlee/ChangeSafe"');
      expect(markup).toContain('aria-describedby="self-hosted-disconnected-notice"');
      expect(metadata.title).toBe(
        "ChangeSafe Workbench — Authenticated Self-Hosted",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL;
      } else {
        process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL = previous;
      }
    }
  });

  it("labels the browser-visible public gateway and has no client credential surface", () => {
    const pageSource = readFileSync("app/workbench/self-hosted/page.tsx", "utf8");
    const transportSource = readFileSync(
      "features/reviews/selfHostedReviewTransport.ts",
      "utf8",
    );
    const uiSource = readFileSync(
      "components/SelfHostedReviewWorkbench.tsx",
      "utf8",
    );

    expect(pageSource).toContain("CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL");
    expect(pageSource).not.toContain("CHANGESAFE_SELF_HOSTED_BASE_URL");
    expect(transportSource).not.toMatch(/authorization|bearer/i);
    expect(uiSource).toContain("browser-visible HTTPS gateway URL");
    expect(uiSource).toContain("public setting must contain no credential");
    expect(uiSource).not.toMatch(/type=["'](?:url|password)["']/);
    expect(uiSource).not.toContain("localStorage");
    expect(uiSource).not.toContain("sessionStorage");
  });

  it("renders the public gateway trust boundary when configured", () => {
    const previous = process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL;
    process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL =
      "https://review-gateway.example.test";
    try {
      const markup = renderToStaticMarkup(createElement(SelfHostedWorkbenchPage));
      expect(markup).toContain("public, browser-visible configuration");
      expect(markup).toContain("must use HTTPS");
      expect(markup).toContain("HttpOnly session cookie");
      expect(markup).not.toContain("Self-hosted review is not configured");
    } finally {
      if (previous === undefined) {
        delete process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL;
      } else {
        process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL = previous;
      }
    }
  });

  it("wires explicit resolution state and disables queue selection while busy", () => {
    const uiSource = readFileSync(
      "components/SelfHostedReviewWorkbench.tsx",
      "utf8",
    );
    expect(uiSource).toContain(
      "resolutionStatus={viewState.resolutionStatus}",
    );
    expect(uiSource).toContain("<SelfHostedReviewQueue");
    expect(uiSource).toContain("disabled={busy}");
  });
});
