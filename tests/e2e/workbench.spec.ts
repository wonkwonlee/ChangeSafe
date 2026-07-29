import { expect, test, type Page } from "@playwright/test";

function observeApiRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      requests.push(`${request.method()} ${url.pathname}`);
    }
  });
  return requests;
}

test("public workbench exposes its static desktop capability boundary", async ({ page }) => {
  const apiRequests = observeApiRequests(page);

  await page.goto("/workbench");

  await expect(page).toHaveTitle("ChangeSafe Workbench — Public Replay");
  await expect(page.getByText("Public replay", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Review context" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Review canvas" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Review authority" })).toBeVisible();

  const desktopColumnCount = await page.locator("#review").evaluate((element) => {
    return getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
  });
  expect(desktopColumnCount).toBe(3);

  await expect(page.getByRole("button", { name: /approve|reject|execute/i })).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);

  const queueVariant = page.getByText("Review queue / self-hosted", { exact: true }).locator("..");
  await expect(queueVariant).toHaveAttribute("aria-disabled", "true");
  await expect(queueVariant).toHaveAttribute("aria-describedby", "review-queue-unavailable");
  await expect(
    page.getByText(
      "Unavailable in public replay: requires an authenticated self-hosted runtime and durable review-record storage.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test.describe("mobile workbench", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stacks the three review regions into one column", async ({ page }) => {
    const apiRequests = observeApiRequests(page);

    await page.goto("/workbench");

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
    expect(apiRequests).toEqual([]);
  });
});
