import { expect, test, type Page } from "@playwright/test";

const forbiddenControlName = /\b(?:approve|approval|reject|decision|simulate|simulation|receipt|execute|execution)\b/i;

async function expectNoAuthorityControls(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: forbiddenControlName })).toHaveCount(0);
  await expect(page.getByRole("link", { name: forbiddenControlName })).toHaveCount(0);
}

interface DataRequestMetadata {
  readonly resourceType: "fetch" | "xhr";
  readonly method: string;
  readonly pathname: string;
}

async function interceptDataRequests(page: Page): Promise<DataRequestMetadata[]> {
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

test("Kubernetes public workbench evaluates an offline manifest without cluster contact or apply", async ({ page }) => {
  const dataRequests = await interceptDataRequests(page);
  await page.goto("/workbench/kubernetes");

  await expect(page).toHaveTitle("ChangeSafe Kubernetes Workbench — Public Replay");
  await expect(page.getByRole("main", { name: "Kubernetes review canvas" })).toBeVisible();
  await expect(page.getByText("No evaluated proposal is available yet.")).toBeVisible();
  await expect(page.getByText(/No cluster is contacted/)).toBeVisible();
  await expect(page.getByText("Fixture provenance").locator("..")).toContainText("authored-synthetic");
  await expect(page.getByRole("button", { name: "Run replay" })).toBeVisible();
  // Unsupported content is intentionally not a selectable replay. It is
  // rejected by the V1 route before evaluation, so the public surface must
  // not make it look like an evaluable Kubernetes manifest.
  await expect(page.getByRole("button", { name: /Unsupported Secret manifest/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.locator('[data-phase="APPROVAL_REQUIRED"]')).toBeVisible();
  await expect(page.getByRole("list", { name: "Evaluated Kubernetes policy findings" })).toBeVisible();
  await expect(page.getByText(/Unavailable and not run/)).toBeVisible();
  await expect(page.getByText(/no validated simulation result/)).toBeVisible();
  await expect(page.getByText(/never contacts this cluster or applies infrastructure changes/)).toBeVisible();
  await expectNoAuthorityControls(page);
  expect(dataRequests).toEqual([{ resourceType: "fetch", method: "POST", pathname: "/api/reviews/analyze" }]);
});

test("Kubernetes workbench navigation can switch domains", async ({ page }) => {
  await page.goto("/workbench/kubernetes");
  await page.getByRole("link", { name: "Terraform" }).click();
  await expect(page).toHaveURL(/\/workbench\/terraform$/);
  await expect(page.getByRole("main", { name: "Terraform review canvas" })).toBeVisible();
});

test("Kubernetes public workbench preserves selector red-team provenance and blocks it", async ({ page }) => {
  const dataRequests = await interceptDataRequests(page);
  await page.goto("/workbench/kubernetes");

  await page.getByRole("button", { name: /Service selector break/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Service selector break" })).toBeVisible();
  await expect(page.getByText("Fixture provenance").locator("..")).toContainText("authored-red-team");
  await expect(page.getByText("Current snapshot relationships")).toBeVisible();
  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.locator('[data-phase="BLOCKED"]')).toBeVisible();
  await expect(page.getByText(/BLOCKED by deterministic findings/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Evaluated Kubernetes policy findings" })).toBeVisible();
  await expectNoAuthorityControls(page);
  expect(dataRequests).toEqual([{ resourceType: "fetch", method: "POST", pathname: "/api/reviews/analyze" }]);
});
