import { POLICY_VERSION } from "@changesafe/domain-kubernetes/offline";

import { DOMAIN_REGISTRY } from "../registry";
import {
  ReviewExampleDescriptorSchema,
  type ReviewExampleDescriptor,
} from "../review-contract";
import {
  composeSessionCapabilities,
  defineTransportCapabilitySource,
} from "../runtime";
import { KUBERNETES_PUBLIC_REPLAY_FIXTURES } from "./fixtures";

const kubernetesMetadata = DOMAIN_REGISTRY.entries.find(
  (entry) => entry.domainId === "kubernetes",
);
if (!kubernetesMetadata) {
  throw new Error("Kubernetes review metadata is not registered");
}

const publicReplayCapabilities = composeSessionCapabilities(
  kubernetesMetadata,
  "public-replay",
  defineTransportCapabilitySource({ durableDecision: false }),
);

/** Schema-validated supported Kubernetes replay entry points. */
export const KUBERNETES_REVIEW_EXAMPLES: readonly ReviewExampleDescriptor[] =
  Object.freeze(
    KUBERNETES_PUBLIC_REPLAY_FIXTURES.map((fixture) => {
      const descriptor = ReviewExampleDescriptorSchema.parse({
        domainId: kubernetesMetadata.domainId,
        contractVersion: kubernetesMetadata.contractVersion,
        sourceId: fixture.sourceId,
        label: fixture.label,
        description: fixture.description,
        // No docs/CASE_STUDIES.md case is a Kubernetes scenario yet.
        caseStudy: null,
        session: {
          domainId: kubernetesMetadata.domainId,
          contractVersion: kubernetesMetadata.contractVersion,
          policyVersion: POLICY_VERSION,
          domainShape: kubernetesMetadata.domainShape,
          capabilities: publicReplayCapabilities,
          runtimeMode: "public-replay",
          // Provenance is the corpus's own declaration; a captured proposal
          // must never be presented as an authored fixture, or the reverse.
          source:
            fixture.provenance === "captured-replay"
              ? "bundled-replay"
              : "authored-fixture",
          analysisMode: "replay",
          provenance: fixture.provenance,
        },
      });
      return Object.freeze({
        ...descriptor,
        session: Object.freeze({
          ...descriptor.session,
          capabilities: Object.freeze({ ...descriptor.session.capabilities }),
        }),
      });
    }),
  );
