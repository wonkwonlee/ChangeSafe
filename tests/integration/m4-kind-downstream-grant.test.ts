import { it } from "vitest";
import { issueKindGrant } from "./kind-grant-issuer";

// M4 experiment 03 (docs/M4_EXPERIMENT_03.md): a reviewed, approved grant
// for a write that a second, independent validating webhook is set up to
// reject — so this grant is honoured and consumed by the enforcer while the
// API server never persists the write. Driven by kind-repro.sh only.
it.skipIf(!process.env.CHANGESAFE_KIND_WORK_DIR)("issues a grant for a write a downstream admission stage will reject", async () => {
  await issueKindGrant({
    reviewId: "review-kind-m4-downstream",
    currentFile: "web-current-m4.json",
    grantFile: "m4-grant.json",
    mutate: candidate => {
      candidate.spec.replicas = 5;
      const labels = (candidate.metadata.labels ?? {}) as Record<string, string>;
      candidate.metadata.labels = { ...labels, "m4.changesafe.dev/downstream": "reject" };
    },
    expectedLedgerCount: 2,
  });
});
