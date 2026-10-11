import { it } from "vitest";
import { issueKindGrant } from "./kind-grant-issuer";

// The cluster driver supplies read-only objects and an ephemeral signing key.
// Default tests never query a cluster or spend model credit.
it.skipIf(!process.env.CHANGESAFE_KIND_WORK_DIR)("authorizes the live kind transition through authenticated durable HTTP", async () => {
  await issueKindGrant({
    reviewId: "review-kind-http",
    currentFile: "web-current.json",
    grantFile: "step1-grant.json",
    mutate: candidate => { candidate.spec.replicas = 4; },
    expectedLedgerCount: 1,
  });
});
