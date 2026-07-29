import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewWorkbenchShell } from "../../components/ReviewWorkbenchShell";
import { getScenario } from "../../scenarios";

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
    expect(markup).toContain("Ephemeral session");
    expect(markup).toContain("No durable review record");
    expect(markup).toContain("No signed or ledger-backed receipt");
    expect(markup).not.toMatch(/<(?:button|form|input|select|textarea)\b/);
    expect(markup).not.toMatch(/>\s*(?:Approve|Reject|Execute)\s*</i);
  });

  it("exposes honest public and self-hosted runtime variants without enabling selection", () => {
    const markup = renderShell();

    expect(markup).toContain('role="group" aria-labelledby="runtime-variants-title"');
    expect(markup).toContain('id="runtime-variants-title"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Examples / public replay");
    expect(markup).toContain("Available");
    expect(markup).toContain(
      'aria-disabled="true" aria-describedby="review-queue-unavailable"',
    );
    expect(markup).toContain("Review queue / self-hosted");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain('id="review-queue-unavailable"');
    expect(markup).toContain(
      "Unavailable in public replay: requires an authenticated self-hosted runtime and durable review-record storage.",
    );
    expect(markup).not.toContain("durable decision storage");
    expect(markup).not.toMatch(/<(?:button|input|select)\b/);
  });

  it("renders factual review data only from the production-schema-parsed bundled replay", () => {
    const scenario = getScenario("scenario-a-failover");
    if (!scenario) throw new Error("Expected bundled failover scenario");

    const markup = renderShell();

    expect(markup).toContain(scenario.bundle.incidentId);
    expect(markup).toContain(scenario.bundle.title);
    expect(markup).toContain(scenario.bundle.summary);
    expect(markup).toContain(scenario.fixture.fixtureId);
    expect(markup).toContain(scenario.fixture.provenance);
    expect(markup).toContain(scenario.fixture.model);
    expect(markup).toContain(scenario.fixture.capturedAtUtc);
    expect(markup).toContain(scenario.fixture.proposal.summary);
    expect(markup).toContain(scenario.expectations.riskLevel);
    expect(markup).toContain(
      scenario.expectations.approvable
        ? "Declared approval expectation: permitted"
        : "Declared approval expectation: prohibited",
    );

    for (const alert of scenario.bundle.alerts) {
      expect(markup).toContain(alert.evidenceId);
      expect(markup).toContain(alert.message);
    }
    for (const evidenceId of scenario.fixture.proposal.diagnosis.evidenceIds) {
      expect(markup).toContain(evidenceId);
    }
    for (const [policyId, status] of Object.entries(scenario.expectations.policies)) {
      expect(markup).toContain(policyId);
      expect(markup).toContain(`>${status}<`);
    }

    expect(markup).not.toContain("evt-1042");
    expect(markup).not.toContain("topo-core-01");
  });

  it("keeps the static shell isolated from client and decision authority", () => {
    const source = readFileSync("components/ReviewWorkbenchShell.tsx", "utf8");
    const forbidden = [
      ["client component directive", /^\s*["']use client["'];/m],
      ["React hook", /\buse(?:State|Effect|Reducer|Ref|Memo|Callback|Context|Transition)\s*\(/],
      ["event handler", /\bon[A-Z][A-Za-z]*\s*=/],
      [
        "workflow, state-machine, or policy import",
        /from\s+["'][^"']*(?:useWorkflow|state-machine|policies?)[^"']*["']/,
      ],
      [
        "workflow, policy, or simulation authority",
        /\b(?:evaluatePolicies|initialState|transition|runSimulation)\s*\(/,
      ],
      ["network request", /\bfetch\s*\(/],
      ["decision or execution control", /<(?:button|form|input|select|textarea)\b/],
    ] as const;

    for (const [boundary, pattern] of forbidden) {
      expect(source, boundary).not.toMatch(pattern);
    }
  });

  it("declares a one-column mobile layout and an explicit three-region desktop grid", () => {
    const source = readFileSync("components/ReviewWorkbenchShell.tsx", "utf8");
    const markup = renderShell();
    const desktopGrid =
      "xl:grid-cols-[minmax(220px,0.75fr)_minmax(0,2fr)_minmax(280px,0.95fr)]";

    expect(source).toContain('id="review"');
    expect(source).toContain("grid-cols-1");
    expect(source).toContain(desktopGrid);
    expect(markup).toContain(`grid-cols-1`);
    expect(markup).toContain(desktopGrid);

    const context = markup.indexOf('aria-label="Review context"');
    const canvas = markup.indexOf('aria-label="Review canvas"');
    const authority = markup.indexOf('aria-label="Review authority"');
    expect(context).toBeGreaterThan(-1);
    expect(canvas).toBeGreaterThan(context);
    expect(authority).toBeGreaterThan(canvas);
  });

  it("keeps one page heading and never skips a semantic heading level", () => {
    const markup = renderShell();
    const headingLevels = [...markup.matchAll(/<h([1-6])\b/g)].map((match) =>
      Number(match[1]),
    );

    expect(headingLevels[0]).toBe(1);
    expect(headingLevels.filter((level) => level === 1)).toHaveLength(1);
    for (let index = 1; index < headingLevels.length; index += 1) {
      const previous = headingLevels[index - 1];
      const current = headingLevels[index];
      if (previous === undefined || current === undefined) {
        throw new Error("Expected every rendered heading to have a semantic level");
      }
      expect(current, `heading ${index + 1} must not skip a level`).toBeLessThanOrEqual(
        previous + 1,
      );
    }
  });
});
