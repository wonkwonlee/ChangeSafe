import { expect, test } from "@playwright/test";

test("self-hosted workbench shows a disconnected explainer, not a dead interactive shell, when no gateway is configured", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "fetch" || request.resourceType() === "xhr") {
      requests.push(request.url());
    }
  });

  await page.goto("/workbench/self-hosted");

  await expect(page).toHaveTitle(
    "ChangeSafe Workbench — Authenticated Self-Hosted",
  );
  await expect(page.getByRole("navigation", { name: "Product navigation" })).toContainText(
    "Network",
  );
  // No gateway configured: the three-pane authenticated shell (intake form,
  // review detail, queue) never renders — replaced by an explainer of what
  // self-hosting adds, so there is no dead interactive control on the page.
  await expect(
    page.getByText(
      "The public deployment at change-safe.vercel.app has none configured, so the queue below is empty by design",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beyond public replay" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Independent receipt proof" })).toBeVisible();
  await expect(page.getByText("Fictional claims for illustration only")).toBeVisible();
  await expect(page.getByLabel("Example artifact")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to authenticated queue" })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("retired compatibility endpoints stay unavailable", async ({ request }) => {
  await expect((await request.get("/workbench")).status()).toBe(404);
  await expect(
    (
      await request.post("/api/analyze", {
        data: { scenarioId: "scenario-a-safe-acl", mode: "replay" },
      })
    ).status(),
  ).toBe(404);
});
