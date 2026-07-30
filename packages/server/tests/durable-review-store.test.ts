import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { hashCanonical } from "@changesafe/core";
import { normalizePlan } from "@changesafe/domain-terraform";
import { TERRAFORM_PUBLIC_REPLAY_FIXTURES } from "../../../features/domains/terraform/fixtures";
import { SCENARIOS } from "../../../scenarios";
import { DurableReviewStore } from "../src/durable-review-store";

const sha = (character: string) => character.repeat(64);
const nodeRequire = createRequire(import.meta.url);

function temporaryDatabasePath(): { path: string; remove(): void } {
  const directory = mkdtempSync(join(tmpdir(), "changesafe-durable-review-store-"));
  return {
    path: join(directory, "reviews.sqlite"),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

async function record(
  reviewId: string,
  sourceId = "network-source",
  receiptSha256 = sha("c"),
) {
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
      receiptSha256,
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

  it("makes an exact record idempotent across independent store instances", async () => {
    const database = temporaryDatabasePath();
    const first = DurableReviewStore.open(database.path);
    const second = DurableReviewStore.open(database.path);
    try {
      const candidate = await record("cross-process-review");
      const [one, two] = await Promise.all([first.append(candidate), second.append(candidate)]);

      expect(one).toEqual(two);
      expect(one).toMatchObject({ seq: 1, reviewId: "cross-process-review" });
      expect(first.count()).toBe(1);
      expect(second.get("cross-process-review")).toEqual(one);
    } finally {
      first.close();
      second.close();
      database.remove();
    }
  });

  it("refuses a receipt identity or receipt hash already bound to another review", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const first = await record("review-one");
      await store.append(first);

      const receiptIdCollision = await record("review-two");
      await expect(
        store.append({
          ...receiptIdCollision,
          receipt: { ...receiptIdCollision.receipt, receiptId: first.receipt.receiptId },
        }),
      ).rejects.toThrow(/already bound to review review-one/);

      const receiptHashCollision = await record("review-three");
      await expect(
        store.append({
          ...receiptHashCollision,
          receipt: { ...receiptHashCollision.receipt, receiptSha256: first.receipt.receiptSha256 },
        }),
      ).rejects.toThrow(/already bound to review review-one/);
      expect(store.count()).toBe(1);
    } finally {
      store.close();
    }
  });

  it("does not let INSERT OR REPLACE bypass the append-only SQLite triggers", async () => {
    const database = temporaryDatabasePath();
    const store = DurableReviewStore.open(database.path);
    try {
      const candidate = await record("replace-protected-review");
      await store.append(candidate);

      const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
      const raw = new sqlite.DatabaseSync(database.path);
      try {
        // recursive_triggers is connection-local. This is the same mandatory
        // setting applied by DurableReviewStore.open for every service-owned
        // connection; direct filesystem access is not a supported writer.
        raw.exec("PRAGMA recursive_triggers = ON");
        expect(() =>
          raw
            .prepare(
              "INSERT OR REPLACE INTO durable_review_records (review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              candidate.reviewId,
              candidate.createdAtUtc,
              candidate.intake.domainId,
              candidate.intake.source.sourceId,
              candidate.intake.input.inputId,
              candidate.receipt.receiptId,
              candidate.receipt.receiptSha256,
              JSON.stringify(candidate),
            ),
        ).toThrow(/append-only/);
      } finally {
        raw.close();
      }
      expect(store.get(candidate.reviewId)?.record).toEqual(candidate);
    } finally {
      store.close();
      database.remove();
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
      await store.append(await record("review-two", "source-b", sha("d")));

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
