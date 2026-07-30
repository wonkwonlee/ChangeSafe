import { describe, expect, it } from "vitest";

import { verifyDurableReviewIntake } from "@/features/reviews/durable-review-contract";
import {
  SELF_HOSTED_REVIEW_EXAMPLES,
  createSelfHostedIntake,
} from "@/features/reviews/selfHostedReviewExamples";

const observedAtUtc = "2026-07-30T12:00:00.000Z";

describe("self-hosted review examples", () => {
  it("constructs hash-bound Network and Terraform offline intake", async () => {
    for (const domainId of ["network", "terraform"] as const) {
      const example = SELF_HOSTED_REVIEW_EXAMPLES.find(
        (candidate) => candidate.domainId === domainId,
      );
      if (!example) throw new Error(`Expected a ${domainId} example.`);
      const intake = await createSelfHostedIntake(example, observedAtUtc);
      await expect(verifyDurableReviewIntake(intake)).resolves.toEqual(intake);
      expect(intake.source.origin).toBe("uploaded-offline-artifact");
      expect(intake.source.untrustedArtifactObservedAtUtc).toBe(observedAtUtc);
    }
  });

  it("keeps Kubernetes durable intake explicitly unsupported", async () => {
    const kubernetes = SELF_HOSTED_REVIEW_EXAMPLES.find(
      ({ domainId }) => domainId === "kubernetes",
    );
    if (!kubernetes) throw new Error("Expected a Kubernetes descriptor.");
    await expect(createSelfHostedIntake(kubernetes, observedAtUtc)).rejects.toThrow(
      "unsupported",
    );
  });
});
