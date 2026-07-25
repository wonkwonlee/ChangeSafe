import { describe, expect, it } from "vitest";

import { createReceipt, verifyReceiptHash, type ReceiptInput } from "@changesafe/core";
import {
  buildFinding,
  buildIncidentBundle,
  buildProposal,
  buildSimulation,
} from "@/tests/helpers/fixtures";

function baseInput(): ReceiptInput {
  return {
    sourceId: "scenario-test",
    inputId: buildIncidentBundle().incidentId,
    input: buildIncidentBundle(),
    proposal: buildProposal(),
    appVersion: "0.1.0",
    policyVersion: "test-policies",
    mode: "replay",
    model: null,
    fixtureProvenance: "authored_synthetic",
    findings: [buildFinding("PASS")],
    riskLevel: "LOW",
    decision: "rejected",
    simulation: null,
    createdAtUtc: "2026-07-19T00:00:00Z",
    receiptId: "rcpt-fixed-for-tests",
  };
}

describe("createReceipt", () => {
  it("produces identical hashes for identical inputs", async () => {
    const first = await createReceipt(baseInput());
    const second = await createReceipt(baseInput());
    expect(first.receiptSha256).toBe(second.receiptSha256);
    expect(first.inputSha256).toBe(second.inputSha256);
    expect(first.proposalSha256).toBe(second.proposalSha256);
  });

  it("changes the receipt hash when any content changes", async () => {
    const first = await createReceipt(baseInput());
    const second = await createReceipt({ ...baseInput(), riskLevel: "MEDIUM" });
    expect(first.receiptSha256).not.toBe(second.receiptSha256);
  });

  it("self-hash excludes the hash field and verifies", async () => {
    const receipt = await createReceipt(baseInput());
    expect(await verifyReceiptHash(receipt)).toBe(true);
    expect(await verifyReceiptHash({ ...receipt, riskLevel: "HIGH" })).toBe(false);
  });

  it("supports the approved+simulated shape", async () => {
    const receipt = await createReceipt({
      ...baseInput(),
      decision: "approved",
      simulation: buildSimulation(),
    });
    expect(receipt.decision).toBe("approved");
    expect(receipt.simulation).not.toBeNull();
  });

  it("refuses invariant-breaking combinations even via direct calls", async () => {
    await expect(
      createReceipt({ ...baseInput(), decision: "blocked", simulation: buildSimulation() }),
    ).rejects.toThrow();
    await expect(
      createReceipt({ ...baseInput(), decision: "approved", simulation: null }),
    ).rejects.toThrow();
    await expect(
      createReceipt({ ...baseInput(), mode: "live", model: "gpt-5.6" }),
    ).rejects.toThrow();
  });
});
