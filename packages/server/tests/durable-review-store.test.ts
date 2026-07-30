import { describe, expect, it } from "vitest";

import { hashCanonical } from "@changesafe/core";
import { normalizePlan } from "@changesafe/domain-terraform";
import { TERRAFORM_PUBLIC_REPLAY_FIXTURES } from "../../../features/domains/terraform/fixtures";
import { SCENARIOS } from "../../../scenarios";
import { DurableReviewStore } from "../src/durable-review-store";

const sha = (character: string) => character.repeat(64);

async function record(reviewId: string, sourceId = "network-source") {
  const content = SCENARIOS[0]!.bundle;
  const inputSha256 = await hashCanonical(content);
  return {
    recordVersion: "1",
    reviewId,
    createdAtUtc: "2026-07-30T01:00:00.000Z",
    session: {
      domainId: "network",
      contractVersion: "2.0.0",
      policyVersion: "network-policy-v1",
      domainShape: "simulated-state",
      capabilities: {
        sandboxSimulation: true,
        resourceGraph: true,
        structuredDiff: true,
        untrustedContext: true,
        durableDecision: true,
      },
      runtimeMode: "self-hosted",
      source: "uploaded-offline-artifact",
      analysisMode: "offline",
      provenance: "uploaded-offline-artifact",
    },
    intake: {
      domainId: "network",
      source: {
        domainId: "network",
        sourceId,
        sourceKind: "network-incident-bundle",
        origin: "uploaded-offline-artifact",
        collectedAtUtc: "2026-07-30T00:00:00.000Z",
      },
      input: { inputId: "network-input", inputSha256, content },
    },
    receipt: {
      receiptId: `${reviewId}-receipt`,
      sourceId,
      inputId: "network-input",
      inputSha256,
      proposalId: `${reviewId}-proposal`,
      proposalSha256: sha("b"),
      policyVersion: "network-policy-v1",
      receiptSha256: sha("c"),
    },
    storage: { kind: "append-only-ledger" },
  } as const;
}

async function terraformRecord(reviewId: string) {
  const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES[0]!;
  const content = normalizePlan(fixture.plan, {
    planId: fixture.inputId,
    context: [...fixture.context],
  });
  const inputSha256 = await hashCanonical(content);
  return {
    recordVersion: "1",
    reviewId,
    createdAtUtc: "2026-07-30T01:00:00.000Z",
    session: {
      domainId: "terraform",
      contractVersion: "2.0.0",
      policyVersion: "terraform-policy-v1",
      domainShape: "external-diff",
      capabilities: {
        sandboxSimulation: false,
        resourceGraph: true,
        structuredDiff: true,
        untrustedContext: true,
        durableDecision: true,
      },
      runtimeMode: "self-hosted",
      source: "uploaded-offline-artifact",
      analysisMode: "offline",
      provenance: "uploaded-offline-artifact",
    },
    intake: {
      domainId: "terraform",
      source: {
        domainId: "terraform",
        sourceId: "terraform-source",
        sourceKind: "terraform-show-json",
        origin: "uploaded-offline-artifact",
        collectedAtUtc: "2026-07-30T00:00:00.000Z",
      },
      input: { inputId: "terraform-input", inputSha256, content },
    },
    receipt: {
      receiptId: `${reviewId}-receipt`,
      sourceId: "terraform-source",
      inputId: "terraform-input",
      inputSha256,
      proposalId: `${reviewId}-proposal`,
      proposalSha256: sha("b"),
      policyVersion: "terraform-policy-v1",
      receiptSha256: sha("c"),
    },
    storage: { kind: "append-only-ledger" },
  } as const;
}

describe("DurableReviewStore", () => {
  it("accepts a hash-verified durable record exactly once and returns its stable id", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const candidate = await record("review-one");
      const first = await store.append(candidate);
      const repeated = await store.append(candidate);

      expect(first).toMatchObject({ seq: 1, reviewId: "review-one", domainId: "network" });
      expect(repeated).toEqual(first);
      expect(store.count()).toBe(1);
      expect(store.get("review-one")).toEqual(first);
    } finally {
      store.close();
    }
  });

  it("refuses a review id collision that would replace immutable metadata", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      await store.append(await record("review-one"));
      await expect(
        store.append({ ...(await record("review-one", "other-source")) }),
      ).rejects.toThrow(/already records different immutable metadata/);
      expect(store.count()).toBe(1);
    } finally {
      store.close();
    }
  });

  it("accepts Terraform metadata through the same verified append boundary", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const entry = await store.append(await terraformRecord("terraform-review"));
      expect(entry).toMatchObject({
        reviewId: "terraform-review",
        domainId: "terraform",
        sourceId: "terraform-source",
      });
    } finally {
      store.close();
    }
  });

  it("refuses Kubernetes and forged intake claims before a queue row exists", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const candidate = await record("kubernetes-review");
      await expect(
        store.append({
          ...candidate,
          session: { ...candidate.session, domainId: "kubernetes" },
          intake: {
            ...candidate.intake,
            domainId: "kubernetes",
            source: { ...candidate.intake.source, domainId: "kubernetes" },
          },
        }),
      ).rejects.toThrow();
      expect(store.count()).toBe(0);
    } finally {
      store.close();
    }
  });

  it("lists only safely bound queue filters in newest-first sequence order", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      await store.append(await record("review-one", "source-a"));
      await store.append(await record("review-two", "source-b"));

      expect(store.list({ sourceId: "source-a" }).map((entry) => entry.reviewId)).toEqual([
        "review-one",
      ]);
      expect(store.list({ limit: 1 }).map((entry) => entry.reviewId)).toEqual(["review-two"]);
      expect(() => store.list({ sourceId: "source-a' OR 1=1 --" })).toThrow();
    } finally {
      store.close();
    }
  });
});
