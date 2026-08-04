import { expect, test } from "@playwright/test";

test("self-hosted workbench is a separate safe mode when no gateway is configured", async ({
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
  await expect(page.getByRole("main", { name: "Authenticated review detail" })).toBeVisible();
  await expect(page.getByText("Self-hosted review is not configured")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to authenticated queue" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  expect(requests).toEqual([]);

  await page.getByLabel("Example artifact").selectOption(
    "kubernetes-durable-unsupported",
  );
  await expect(
    page.getByText("Unsupported for durable self-hosted review"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to authenticated queue" })).toBeDisabled();
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
