import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FindingsList } from "../../components/StatusTone";

import type { PolicyFinding } from "@changesafe/core";

function finding(overrides: Partial<PolicyFinding> & Pick<PolicyFinding, "policyId" | "status">): PolicyFinding {
  return {
    title: `${overrides.policyId} title`,
    explanation: `${overrides.policyId} explanation`,
    affectedResources: [],
    remediation: null,
    ...overrides,
  };
}

describe("FindingsList", () => {
  it("sorts BLOCK before WARN before PASS, regardless of input order", () => {
    const findings = [
      finding({ policyId: "PASS_ONE", status: "PASS" }),
      finding({ policyId: "BLOCK_ONE", status: "BLOCK" }),
      finding({ policyId: "WARN_ONE", status: "WARN" }),
    ];
    const markup = renderToStaticMarkup(createElement(FindingsList, { findings, ariaLabel: "test findings" }));
    const order = [...markup.matchAll(/id="finding-([A-Z_]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["BLOCK_ONE", "WARN_ONE", "PASS_ONE"]);
  });

  it("summarizes the blocking/warning/passing counts", () => {
    const findings = [
      finding({ policyId: "A", status: "BLOCK" }),
      finding({ policyId: "B", status: "WARN" }),
      finding({ policyId: "C", status: "WARN" }),
      finding({ policyId: "D", status: "PASS" }),
    ];
    const markup = renderToStaticMarkup(createElement(FindingsList, { findings, ariaLabel: "test findings" }));
    expect(markup).toContain("1 blocking · 2 warnings · 1 passing");
  });

  it("renders remediation text for every domain, not only a hand-picked subset", () => {
    const findings = [
      finding({ policyId: "A", status: "BLOCK", remediation: "Do the fix." }),
      finding({ policyId: "B", status: "PASS", remediation: null }),
    ];
    const markup = renderToStaticMarkup(createElement(FindingsList, { findings, ariaLabel: "test findings" }));
    expect(markup).toContain("Remediation: Do the fix.");
  });

  it("gives a BLOCK card distinct chrome, not only a color-swapped status word", () => {
    const findings = [finding({ policyId: "A", status: "BLOCK" })];
    const markup = renderToStaticMarkup(createElement(FindingsList, { findings, ariaLabel: "test findings" }));
    expect(markup).toContain("border-l-4");
  });
});
