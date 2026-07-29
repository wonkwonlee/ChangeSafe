import { expect, test, type Page } from "@playwright/test";

const forbiddenControlName = /\b(?:approve|approval|reject|decision|execute|execution)\b/i;

interface DataRequestMetadata {
  resourceType: "fetch" | "xhr";
  method: string;
  pathname: string;
}

async function interceptFetchAndXhrRequests(page: Page): Promise<DataRequestMetadata[]> {
  const requests: DataRequestMetadata[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    if (resourceType === "fetch" || resourceType === "xhr") {
      requests.push({ resourceType, method: request.method(), pathname: new URL(request.url()).pathname });
    }
    await route.continue();
  });
  return requests;
}

async function expectNoDecisionOrExecutionControls(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: forbiddenControlName })).toHaveCount(0);
  await expect(page.getByRole("link", { name: forbiddenControlName })).toHaveCount(0);
  await expect(page.getByRole("form", { name: forbiddenControlName })).toHaveCount(0);
}

test("public workbench evaluates a selected bundled replay without creating decision authority", async ({ page }) => {
  const dataRequests = await interceptFetchAndXhrRequests(page);
  await page.goto("/workbench");

  await expect(page).toHaveTitle("ChangeSafe Workbench — Public Replay");
  await expect(page.getByRole("main", { name: "Review canvas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run replay" })).toBeVisible();
  await expect(page.getByText("No evaluated proposal is available yet.")).toBeVisible();
  expect(dataRequests).toEqual([]);

  await page.getByRole("button", { name: /INC-4977/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Suspected route leak/ })).toBeVisible();
  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "BLOCKED" })).toBeVisible();
  await expect(page.getByText(/BLOCKED by deterministic findings/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Evaluated policy findings" })).toBeVisible();
  await expect(page.getByText("Not created. This ephemeral public replay")).toBeVisible();
  await expectNoDecisionOrExecutionControls(page);
  expect(dataRequests).toEqual([
    { resourceType: "fetch", method: "POST", pathname: "/api/reviews/analyze" },
  ]);
});

test("public workbench renders a safe replay result without granting its available human decision", async ({ page }) => {
  await page.goto("/workbench");

  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "APPROVAL_REQUIRED" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Risk" }).locator("..")).toContainText("LOW");
  await expect(page.getByText(/gate permits a human decision, but public replay intentionally has no approval/i)).toBeVisible();
  await expect(page.getByText("Not run. Public replay cannot approve a proposal")).toBeVisible();
  await expectNoDecisionOrExecutionControls(page);
});

test.describe("mobile workbench", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stacks interactive review regions into one column", async ({ page }) => {
    await page.goto("/workbench");
    const mobileColumnCount = await page.locator("#review").evaluate((element) => {
      return getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
    });
    expect(mobileColumnCount).toBe(1);
    await expect(page.getByRole("button", { name: "Run replay" })).toBeVisible();
    await expectNoDecisionOrExecutionControls(page);
  });
});
