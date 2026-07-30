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
  await expect(page.getByRole("heading", { level: 2, name: /Suspected route leak/ })).toBeVisible();
  // The selected fixture's authorship must stay visible before the replay is
  // evaluated. In particular, a red-team fixture must never look like a
  // captured model result simply because it travels through the replay path.
  await expect(page.getByText("Fixture provenance").locator(".."))
    .toContainText("authored_red_team");
  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "BLOCKED" })).toBeVisible();
  await expect(page.getByText(/BLOCKED by deterministic findings/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Evaluated policy findings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Risk" }).locator(".."))
    .toContainText("CRITICAL");
  await expect(page.getByText("Not created. This ephemeral public replay")).toBeVisible();
  await expectNoDecisionOrExecutionControls(page);
  expect(dataRequests).toEqual([
    { resourceType: "fetch", method: "POST", pathname: "/api/reviews/analyze" },
  ]);
});

test("public workbench renders a safe replay result without granting its available human decision", async ({ page }) => {
  await page.goto("/workbench");

  // The default fixture is captured. This is deliberately asserted in the
  // public UI as well as the legacy airlock: provenance is an operator-facing
  // safety boundary, not just transport metadata.
  await expect(page.getByText("Fixture provenance").locator(".."))
    .toContainText("captured");
  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "APPROVAL_REQUIRED" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Risk" }).locator("..")).toContainText("LOW");
  await expect(page.getByText(/gate permits a human decision, but public replay intentionally has no approval/i)).toBeVisible();
  await expect(page.getByText("Not run. Public replay cannot approve a proposal")).toBeVisible();
  await expectNoDecisionOrExecutionControls(page);
});

test("network topology has a keyboard-operable equivalent table view", async ({ page }) => {
  await page.goto("/workbench");

  const redTeamExample = page.getByRole("button", { name: /INC-4977/ });
  await redTeamExample.focus();
  await expect(redTeamExample).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(redTeamExample).toBeFocused();
  await expect(
    page.getByRole("heading", { level: 2, name: /Suspected route leak/ }),
  ).toBeVisible();

  const topologyTables = page.locator("summary", {
    hasText: "Accessible topology tables",
  });
  const nodes = page.getByRole("table", { name: "Network nodes" });
  const links = page.getByRole("table", { name: "Network links" });
  await expect(nodes).toBeVisible();
  await expect(links).toBeVisible();

  await topologyTables.focus();
  await expect(topologyTables).toBeFocused();
  await expect
    .poll(() =>
      topologyTables.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.outlineStyle} ${style.outlineWidth}`;
      }),
    )
    .toBe("solid 2px");
  await page.keyboard.press("Enter");
  await expect(nodes).toBeHidden();
  await expect(links).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(nodes).toBeVisible();
  await expect(links).toBeVisible();
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

test.describe("network workbench accessibility preferences", () => {
  test("reflows without document-level horizontal scrolling at a 200% equivalent viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 720 });
    await page.goto("/workbench");

    const hasDocumentOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(hasDocumentOverflow).toBe(false);
    await expect(
      page.locator("summary", { hasText: "Accessible topology tables" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Run replay" })).toBeVisible();
  });

  test("honors reduced-motion preferences", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/workbench");

    const motionDurations = await page
      .getByRole("button", { name: "Run replay" })
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          animation: style.animationDuration,
          transition: style.transitionDuration,
        };
      });
    expect(Number.parseFloat(motionDurations.animation)).toBeLessThanOrEqual(
      0.00001,
    );
    expect(Number.parseFloat(motionDurations.transition)).toBeLessThanOrEqual(
      0.00001,
    );
  });
});
