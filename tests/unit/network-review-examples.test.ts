import { describe, expect, it } from "vitest";

import type { FixtureProvenance } from "@changesafe/core";

import { NETWORK_REVIEW_EXAMPLES } from "@/features/domains/network/examples";
import { ReviewExampleDescriptorSchema } from "@/features/domains/review-contract";
import { REVIEW_CONTRACT_VERSION } from "@/features/domains/review-contract";
import { NETWORK_SCENARIOS } from "@/scenarios";

function expectedOrigin(provenance: FixtureProvenance) {
  switch (provenance) {
    case "captured":
      return ["bundled-replay", "captured-replay"] as const;
    case "authored_synthetic":
      return ["authored-fixture", "authored-synthetic"] as const;
    case "authored_red_team":
      return ["authored-fixture", "authored-red-team"] as const;
  }
}

describe("Network review examples", () => {
  it("maps all nine registered scenarios exactly once", () => {
    const ids = NETWORK_REVIEW_EXAMPLES.map((example) => example.sourceId);

    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
    expect(ids).toEqual(NETWORK_SCENARIOS.map((scenario) => scenario.scenarioId));
  });

  it("publishes schema-valid public replay descriptors with Network metadata", () => {
    for (const descriptor of NETWORK_REVIEW_EXAMPLES) {
      expect(ReviewExampleDescriptorSchema.parse(descriptor)).toEqual(
        descriptor,
      );
      expect(descriptor).toMatchObject({
        domainId: "network",
        contractVersion: REVIEW_CONTRACT_VERSION,
        session: {
          domainId: "network",
          contractVersion: REVIEW_CONTRACT_VERSION,
          domainShape: "simulated-state",
          runtimeMode: "public-replay",
          analysisMode: "replay",
          capabilities: {
            sandboxSimulation: true,
            resourceGraph: true,
            structuredDiff: true,
            untrustedContext: true,
            durableDecision: false,
          },
        },
      });
    }
  });

  it("keeps safe captured and red-team example literals honest", () => {
    expect(
      NETWORK_REVIEW_EXAMPLES.find(
        (example) => example.sourceId === "scenario-a-failover",
      ),
    ).toMatchObject({
      label: "INC-4821 — Degraded primary uplink",
      session: {
        source: "bundled-replay",
        provenance: "captured-replay",
      },
    });
    expect(
      NETWORK_REVIEW_EXAMPLES.find(
        (example) => example.sourceId === "scenario-h-alert-injection",
      ),
    ).toMatchObject({
      label: "INC-5744 — Firewall CPU saturation",
      session: {
        source: "authored-fixture",
        provenance: "authored-red-team",
      },
    });
  });

  it("matches server-route source and provenance classification for every fixture", () => {
    for (const descriptor of NETWORK_REVIEW_EXAMPLES) {
      const scenario = NETWORK_SCENARIOS.find(
        (candidate) => candidate.scenarioId === descriptor.sourceId,
      );
      expect(scenario, descriptor.sourceId).toBeDefined();
      if (!scenario) {
        continue;
      }
      expect(
        [descriptor.session.source, descriptor.session.provenance],
        descriptor.sourceId,
      ).toEqual(expectedOrigin(scenario.fixture.provenance));
    }
  });
});
