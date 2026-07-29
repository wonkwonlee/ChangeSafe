import { expect, test, type Page } from "@playwright/test";

const forbiddenControlName =
  /\b(?:approve|approval|reject|decision|execute|execution)\b/i;

interface DataRequestMetadata {
  resourceType: "fetch" | "xhr";
  method: string;
  origin: string;
  pathname: string;
}

async function interceptFetchAndXhrRequests(
  page: Page,
): Promise<DataRequestMetadata[]> {
  const requests: DataRequestMetadata[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    if (resourceType === "fetch" || resourceType === "xhr") {
      const url = new URL(request.url());
      requests.push({
        resourceType,
        method: request.method(),
        origin: url.origin,
        pathname: url.pathname,
      });
    }
    await route.continue();
  });
  return requests;
}

async function expectWorkbenchReady(page: Page): Promise<void> {
  await expect(page.getByRole("group", { name: "Runtime variant" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Review canvas" })).toBeVisible();
}

async function expectNoDecisionOrExecutionControls(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: forbiddenControlName })).toHaveCount(0);
  await expect(page.getByRole("link", { name: forbiddenControlName })).toHaveCount(0);
  await expect(page.getByRole("form", { name: forbiddenControlName })).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
}

test("public workbench exposes its static desktop capability boundary", async ({ page }) => {
  const dataRequests = await interceptFetchAndXhrRequests(page);

  await page.goto("/workbench");
  await expectWorkbenchReady(page);

  await expect(page).toHaveTitle("ChangeSafe Workbench — Public Replay");
  await expect(page.getByText("Public replay", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Review context" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Review canvas" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Review authority" })).toBeVisible();

  const desktopColumnCount = await page.locator("#review").evaluate((element) => {
    return getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
  });
  expect(desktopColumnCount).toBe(3);

  await expectNoDecisionOrExecutionControls(page);

  const queueVariant = page.locator(
    '[aria-disabled="true"][aria-describedby="review-queue-unavailable"]',
  );
  await expect(queueVariant).toHaveCount(1);
  await expect(queueVariant).toContainText("Review queue / self-hosted");
  await expect(queueVariant).toContainText("Unavailable");
  await expect(queueVariant).toHaveAttribute("aria-disabled", "true");
  await expect(queueVariant).toHaveAttribute("aria-describedby", "review-queue-unavailable");
  await expect(
    page.getByText(
      "Unavailable in public replay: requires an authenticated self-hosted runtime and durable review-record storage.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(dataRequests, "static workbench must not issue fetch/XHR requests").toEqual([]);
});

test.describe("mobile workbench", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stacks the three review regions into one column", async ({ page }) => {
    const dataRequests = await interceptFetchAndXhrRequests(page);

    await page.goto("/workbench");
    await expectWorkbenchReady(page);

    const mobileColumnCount = await page.locator("#review").evaluate((element) => {
      return getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
    });
    expect(mobileColumnCount).toBe(1);

    const contextBox = await page
      .getByRole("complementary", { name: "Review context" })
      .boundingBox();
    const canvasBox = await page.getByRole("main", { name: "Review canvas" }).boundingBox();
    const authorityBox = await page
      .getByRole("complementary", { name: "Review authority" })
      .boundingBox();
    if (!contextBox || !canvasBox || !authorityBox) {
      throw new Error("Expected all three mobile review regions to have layout boxes");
    }

    expect(contextBox.y).toBeLessThan(canvasBox.y);
    expect(canvasBox.y).toBeLessThan(authorityBox.y);
    await expectNoDecisionOrExecutionControls(page);
    expect(dataRequests, "static workbench must not issue fetch/XHR requests").toEqual([]);
  });
});
