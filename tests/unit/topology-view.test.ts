import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TopologyView } from "@/components/TopologyView";
import { SCENARIOS } from "@/scenarios";

describe("TopologyView", () => {
  it("provides visible node and link tables equivalent to the decorative graph", () => {
    const scenario = SCENARIOS[0];
    if (!scenario) throw new Error("Expected a bundled Network scenario");

    const markup = renderToStaticMarkup(
      createElement(TopologyView, {
        topology: scenario.bundle.topology,
        state: scenario.bundle.currentState,
      }),
    );

    expect(markup).toContain('<svg aria-hidden="true"');
    expect(markup).toContain("<details");
    expect(markup).toContain("Accessible topology tables");
    expect(markup).toContain("<caption>Network nodes</caption>");
    expect(markup).toContain("<caption>Network links</caption>");
    expect((markup.match(/scope="col"/g) ?? [])).toHaveLength(9);

    for (const node of scenario.bundle.topology.nodes) {
      expect(markup).toContain(node.id);
      expect(markup).toContain(node.name);
      expect(markup).toContain(node.role);
      if (node.mgmtIp) expect(markup).toContain(node.mgmtIp);
    }
    for (const link of scenario.bundle.topology.links) {
      expect(markup).toContain(link.id);
      expect(markup).toContain(link.a.interfaceId);
      expect(markup).toContain(link.b.interfaceId);
      expect(markup).toContain(link.status);
    }
    expect(markup).toContain("management origin");
    expect(markup).toContain("protected");
  });
});
