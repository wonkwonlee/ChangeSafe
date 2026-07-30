import { hashCanonical } from "@changesafe/core";
import { normalizePlan } from "@changesafe/domain-terraform";

import { TERRAFORM_PUBLIC_REPLAY_FIXTURES } from "@/features/domains/terraform/fixtures";
import type { DurableReviewIntake } from "@/features/reviews/durable-review-contract";
import { SCENARIOS } from "@/scenarios";

export type SelfHostedExampleDomain = "network" | "terraform" | "kubernetes";

export interface SelfHostedReviewExample {
  readonly domainId: SelfHostedExampleDomain;
  readonly sourceId: string;
  readonly label: string;
  readonly description: string;
}
export const SELF_HOSTED_REVIEW_EXAMPLES: readonly SelfHostedReviewExample[] =
  Object.freeze([
    ...SCENARIOS.map((scenario) =>
      Object.freeze({
        domainId: "network" as const,
        sourceId: scenario.scenarioId,
        label: scenario.label,
        description: scenario.shortDescription,
      }),
    ),
    ...TERRAFORM_PUBLIC_REPLAY_FIXTURES.map((fixture) =>
      Object.freeze({
        domainId: "terraform" as const,
        sourceId: fixture.sourceId,
        label: fixture.label,
        description: fixture.description,
      }),
    ),
    Object.freeze({
      domainId: "kubernetes" as const,
      sourceId: "kubernetes-durable-unsupported",
      label: "Kubernetes offline artifact",
      description:
        "Kubernetes remains available for offline public replay, but durable self-hosted intake is not implemented in this release.",
    }),
  ]);

export async function createSelfHostedIntake(
  example: SelfHostedReviewExample,
  observedAtUtc: string,
): Promise<DurableReviewIntake> {
  if (example.domainId === "kubernetes") {
    throw new Error("Kubernetes durable self-hosted intake is unsupported.");
  }
  if (example.domainId === "network") {
    const scenario = SCENARIOS.find(({ scenarioId }) => scenarioId === example.sourceId);
    if (!scenario) throw new Error("The selected Network artifact is unavailable.");
    return {
      domainId: "network",
      source: {
        domainId: "network",
        sourceId: scenario.scenarioId,
        sourceKind: "network-incident-bundle",
        origin: "uploaded-offline-artifact",
        untrustedArtifactObservedAtUtc: observedAtUtc,
      },
      input: {
        inputId: scenario.bundle.incidentId,
        inputSha256: await hashCanonical(scenario.bundle),
        content: scenario.bundle,
      },
      proposal: {
        proposalId: scenario.fixture.proposal.proposalId,
        proposalSha256: await hashCanonical(scenario.fixture.proposal),
        content: scenario.fixture.proposal,
      },
    };
  }

  const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES.find(
    ({ sourceId }) => sourceId === example.sourceId,
  );
  if (!fixture) throw new Error("The selected Terraform artifact is unavailable.");
  const input = normalizePlan(fixture.plan, {
    planId: fixture.inputId,
    context: [...fixture.context],
  });
  return {
    domainId: "terraform",
    source: {
      domainId: "terraform",
      sourceId: fixture.sourceId,
      sourceKind: "terraform-show-json",
      origin: "uploaded-offline-artifact",
      untrustedArtifactObservedAtUtc: observedAtUtc,
    },
    input: {
      inputId: fixture.inputId,
      inputSha256: await hashCanonical(input),
      content: input,
    },
  };
}
