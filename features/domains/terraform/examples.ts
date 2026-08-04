import { POLICY_VERSION } from "@changesafe/domain-terraform";

import { DOMAIN_REGISTRY } from "../registry";
import {
  ReviewExampleDescriptorSchema,
  type ReviewExampleDescriptor,
} from "../review-contract";
import {
  composeSessionCapabilities,
  defineTransportCapabilitySource,
} from "../runtime";
import { TERRAFORM_PUBLIC_REPLAY_FIXTURES } from "./fixtures";

const terraformMetadata = DOMAIN_REGISTRY.entries.find(
  (entry) => entry.domainId === "terraform",
);
if (!terraformMetadata) {
  throw new Error("Terraform review metadata is not registered");
}

const publicReplayCapabilities = composeSessionCapabilities(
  terraformMetadata,
  "public-replay",
  defineTransportCapabilitySource({ durableDecision: false }),
);

/** Scenario ids featured in `docs/CASE_STUDIES.md`, mapped to that doc's case heading. */
const TERRAFORM_CASE_STUDIES: Readonly<Record<string, string>> = Object.freeze({
  "scenario-p-injected-pr-context": "Case 3: Same story, AI coding agent and Terraform",
});

/** Schema-validated public replay entry points for fictional Terraform plans. */
export const TERRAFORM_REVIEW_EXAMPLES: readonly ReviewExampleDescriptor[] =
  Object.freeze(
    TERRAFORM_PUBLIC_REPLAY_FIXTURES.map((fixture) => {
      const descriptor = ReviewExampleDescriptorSchema.parse({
        domainId: terraformMetadata.domainId,
        contractVersion: terraformMetadata.contractVersion,
        sourceId: fixture.sourceId,
        label: fixture.label,
        description: fixture.description,
        caseStudy: TERRAFORM_CASE_STUDIES[fixture.sourceId] ?? null,
        session: {
          domainId: terraformMetadata.domainId,
          contractVersion: terraformMetadata.contractVersion,
          policyVersion: POLICY_VERSION,
          domainShape: terraformMetadata.domainShape,
          capabilities: publicReplayCapabilities,
          runtimeMode: "public-replay",
          source: "authored-fixture",
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
