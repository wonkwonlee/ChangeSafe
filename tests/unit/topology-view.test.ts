import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TopologyView } from "@/components/TopologyView";
import { NETWORK_SCENARIOS } from "@/scenarios";
import type { IncidentBundle } from "@changesafe/domain-network";

describe("TopologyView", () => {
  it("provides visible node and link tables equivalent to the decorative graph", () => {
    const scenario = NETWORK_SCENARIOS[0];
    if (!scenario) throw new Error("Expected a bundled Network scenario");
    const input = scenario.input as IncidentBundle;

    const markup = renderToStaticMarkup(
      createElement(TopologyView, {
        topology: input.topology,
        state: input.currentState,
      }),
    );

    expect(markup).toContain('<svg aria-hidden="true"');
    expect(markup).toContain("<details");
    expect(markup).toContain("Accessible topology tables");
    expect(markup).toContain("<caption>Network nodes</caption>");
    expect(markup).toContain("<caption>Network links</caption>");
    expect((markup.match(/scope="col"/g) ?? [])).toHaveLength(9);

    for (const node of input.topology.nodes) {
      expect(markup).toContain(node.id);
      expect(markup).toContain(node.name);
      expect(markup).toContain(node.role);
      if (node.mgmtIp) expect(markup).toContain(node.mgmtIp);
    }
    for (const link of input.topology.links) {
      expect(markup).toContain(link.id);
      expect(markup).toContain(link.a.interfaceId);
      expect(markup).toContain(link.b.interfaceId);
      expect(markup).toContain(link.status);
    }
    expect(markup).toContain("management origin");
    expect(markup).toContain("protected");
  });
});
