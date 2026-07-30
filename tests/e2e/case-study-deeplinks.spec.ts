import { expect, test } from "@playwright/test";

test("Case 1 deep link pre-selects scenario-a-failover without running replay", async ({ page }) => {
  await page.goto("/?scenario=scenario-a-failover");
  await expect(
    page.getByRole("button", { name: /Degraded primary uplink/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Run replay" })).toBeVisible();
  await expect(page.getByText("No evaluated proposal is available yet.")).toBeVisible();
});

test("Case 2 deep link pre-selects scenario-b-route-leak and shows the case-study badge", async ({ page }) => {
  await page.goto("/?scenario=scenario-b-route-leak");
  const item = page.getByRole("button", { name: /Suspected route leak/ });
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect(item.getByText("Case study")).toBeVisible();
});

test("Case 3 deep link pre-selects scenario-p-injected-pr-context on the Terraform workbench", async ({ page }) => {
  await page.goto("/workbench/terraform?scenario=scenario-p-injected-pr-context");
  const item = page.getByRole("button", { name: /Protected billing database/ });
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect(item.getByText("Case study")).toBeVisible();
});

test("Case 4 deep link pre-selects scenario-g-silent-regression", async ({ page }) => {
  await page.goto("/?scenario=scenario-g-silent-regression");
  await expect(
    page.getByRole("button", { name: /Idle standby transit path/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("an unrecognized scenario id falls back to the default example", async ({ page }) => {
  await page.goto("/?scenario=does-not-exist");
  await expect(
    page.getByRole("button", { name: /Degraded primary uplink/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Case 3 replay run produces the expected CRITICAL/BLOCKED findings", async ({ page }) => {
  await page.goto("/workbench/terraform?scenario=scenario-p-injected-pr-context");
  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "BLOCKED" })).toBeVisible();
});
