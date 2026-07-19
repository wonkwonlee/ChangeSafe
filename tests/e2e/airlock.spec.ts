import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Critical paths through the airlock in replay mode (no API key required):
 * 1. Safe scenario A: analyze → validate → approve → simulate → receipt.
 * 2. Unsafe scenario B: analyze → BLOCK → approval impossible → blocked receipt.
 * 3. Reset returns a clean READY state.
 */

test("safe scenario: analyze, approve, simulate, and download a verified receipt", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Run replay analysis" })).toBeVisible();
  await page.getByRole("button", { name: "Run replay analysis" }).click();

  // Honest provenance label and full-PASS gate.
  await expect(page.getByText("Authored replay fixture — not model output")).toBeVisible();
  await expect(page.getByText("7 PASS")).toBeVisible();
  await expect(page.getByText("risk: LOW")).toBeVisible();

  await page.getByRole("button", { name: "Approve & simulate" }).click();

  await expect(page.getByText("Final decision:")).toBeVisible();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await expect(
    page.getByText("All declared safety properties remain satisfied in the sandbox."),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download receipt JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^changesafe-receipt-rcpt-[a-z0-9-]+\.json$/);

  const downloadPath = await download.path();
  const receipt = JSON.parse(readFileSync(downloadPath, "utf8")) as Record<string, unknown>;
  expect(receipt.decision).toBe("approved");
  expect(receipt.mode).toBe("replay");
  expect(receipt.fixtureProvenance).toBe("authored_synthetic");
  expect(receipt.model).toBeNull();
  expect(String(receipt.receiptSha256)).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.simulation).not.toBeNull();
  expect(JSON.stringify(receipt)).not.toContain("OPENAI_API_KEY");
});

test("unsafe scenario: blocked by the gate, approval impossible, blocked receipt issued", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("Scenario").selectOption("scenario-b-route-leak");
  await page.getByRole("button", { name: "Run replay analysis" }).click();

  // Red-team provenance is labeled honestly; required findings appear.
  await expect(page.getByText("Authored red-team fixture — not model output")).toBeVisible();
  await expect(page.getByText("2 BLOCK", { exact: true })).toBeVisible();
  await expect(page.getByText("risk: CRITICAL")).toBeVisible();
  await expect(page.getByText("Change severs management reachability")).toBeVisible();
  await expect(page.getByText("Change removes or disables a protected resource")).toBeVisible();
  await expect(
    page.getByText("Incident content contains instruction-like language"),
  ).toBeVisible();

  // Approval is visibly impossible.
  await expect(page.getByText("Approval is not possible")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve change" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approve & simulate" })).toHaveCount(0);

  await page.getByRole("button", { name: "Issue blocked receipt" }).click();

  await expect(page.getByText("blocked", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Not run — simulation only executes for changes a human approved."),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download receipt JSON" }).click();
  const download = await downloadPromise;
  const receipt = JSON.parse(readFileSync(await download.path(), "utf8")) as Record<
    string,
    unknown
  >;
  expect(receipt.decision).toBe("blocked");
  expect(receipt.riskLevel).toBe("CRITICAL");
  expect(receipt.simulation).toBeNull();
  expect(receipt.fixtureProvenance).toBe("authored_red_team");
});

test("reset returns a clean ready state", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Run replay analysis" }).click();
  await expect(page.getByText("7 PASS")).toBeVisible();

  await page.getByRole("button", { name: "Reset scenario" }).click();

  await expect(page.getByRole("button", { name: "Run replay analysis" })).toBeVisible();
  await expect(page.getByText("7 PASS")).toHaveCount(0);
  await expect(page.getByText("Waiting for a proposal", { exact: false })).toBeVisible();

  // Switching scenarios also produces a clean READY state.
  await page.getByRole("button", { name: "Run replay analysis" }).click();
  await expect(page.getByText("7 PASS")).toBeVisible();
  await page.getByLabel("Scenario").selectOption("scenario-b-route-leak");
  await expect(page.getByRole("button", { name: "Run replay analysis" })).toBeVisible();
  await expect(page.getByText("2 BLOCK", { exact: true })).toHaveCount(0);
});
