import { expect, test } from "@playwright/test";

const forbiddenControlName = /\b(?:approve|approval|reject|decision|simulate|simulation|receipt|execute|execution)\b/i;

async function expectNoAuthorityControls(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("button", { name: forbiddenControlName })).toHaveCount(0);
  await expect(page.getByRole("link", { name: forbiddenControlName })).toHaveCount(0);
}

test("Terraform public workbench evaluates a supplied external diff without Terraform execution", async ({ page }) => {
  await page.goto("/workbench/terraform");

  await expect(page).toHaveTitle("ChangeSafe Terraform Workbench — Public Replay");
  await expect(page.getByRole("main", { name: "Terraform review canvas" })).toBeVisible();
  await expect(page.getByText("No evaluated proposal is available yet.")).toBeVisible();
  await expect(page.getByText(/Terraform is not run/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Run replay" })).toBeVisible();

  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "APPROVAL_REQUIRED" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Evaluated Terraform policy findings" })).toBeVisible();
  await expect(page.getByText(/Unavailable and not run/)).toBeVisible();
  await expectNoAuthorityControls(page);
});

test("Terraform public workbench blocks a supplied database destroy from deterministic findings", async ({ page }) => {
  await page.goto("/workbench/terraform");

  await page.getByRole("button", { name: /Database destroy/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Database destroy" })).toBeVisible();
  await expect(page.getByText("Destructive plan action")).toBeVisible();
  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "BLOCKED" })).toBeVisible();
  await expect(page.getByText(/BLOCKED by deterministic findings/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Evaluated Terraform policy findings" })).toBeVisible();
  await expectNoAuthorityControls(page);
});
