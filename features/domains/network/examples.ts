import type { FixtureProvenance } from "@changesafe/core";

import { SCENARIOS } from "../../../scenarios";
import { DOMAIN_REGISTRY } from "../registry";
import {
  ReviewExampleDescriptorSchema,
  type ReviewExampleDescriptor,
  type ReviewProvenance,
  type ReviewSource,
} from "../review-contract";
import {
  composeSessionCapabilities,
  defineTransportCapabilitySource,
} from "../runtime";

const networkMetadata = DOMAIN_REGISTRY.entries.find(
  (entry) => entry.domainId === "network",
);
if (!networkMetadata) {
  throw new Error("Network review metadata is not registered");
}

const publicReplayCapabilities = composeSessionCapabilities(
  networkMetadata,
  "public-replay",
  defineTransportCapabilitySource({ durableDecision: false }),
);

export const NETWORK_REVIEW_EXAMPLES: readonly ReviewExampleDescriptor[] =
  Object.freeze(
    SCENARIOS.map((scenario) => {
      const origin = reviewOrigin(scenario.fixture.provenance);
      const descriptor = ReviewExampleDescriptorSchema.parse({
        domainId: networkMetadata.domainId,
        contractVersion: networkMetadata.contractVersion,
        sourceId: scenario.scenarioId,
        label: scenario.label,
        description: scenario.shortDescription,
        session: {
          domainId: networkMetadata.domainId,
          contractVersion: networkMetadata.contractVersion,
          domainShape: networkMetadata.domainShape,
          capabilities: publicReplayCapabilities,
          runtimeMode: "public-replay",
          source: origin.source,
          analysisMode: "replay",
          provenance: origin.provenance,
        },
      });
      return Object.freeze({
        ...descriptor,
        session: Object.freeze({
          ...descriptor.session,
          capabilities: Object.freeze({
            ...descriptor.session.capabilities,
          }),
        }),
      });
    }),
  );

function reviewOrigin(provenance: FixtureProvenance): {
  readonly source: ReviewSource;
  readonly provenance: ReviewProvenance;
} {
  switch (provenance) {
    case "captured":
      return {
        source: "bundled-replay",
        provenance: "captured-replay",
      };
    case "authored_synthetic":
      return {
        source: "authored-fixture",
        provenance: "authored-synthetic",
      };
    case "authored_red_team":
      return {
        source: "authored-fixture",
        provenance: "authored-red-team",
      };
  }
}
