import { expect, test, type Page } from "@playwright/test";

const AUTHORITY_CONTROL_NAME =
  /\b(?:approve|approval|reject|decision|receipt|simulate|simulation|execute|execution|apply|terraform apply|kubectl apply|sign)\b/i;
const DISALLOWED_PUBLIC_DATA_PATH =
  /^\/api\/(?!(?:reviews\/analyze)$)(?:reviews|decisions|receipts?|ledger|analyze|eval|openai|anthropic|ollama|aws|terraform|kubernetes)(?:\/|$)/i;

interface PublicReplayRoute {
  readonly route: string;
  readonly domainId: "network" | "terraform" | "kubernetes";
  readonly sourceId: string;
  readonly selectedExampleName: RegExp;
  readonly expectedEffectCapability: "sandbox-simulation" | "external-diff";
  readonly noReceiptText: RegExp;
  readonly noSimulationOrExecutionText: RegExp;
}

interface DataRequest {
  readonly method: string;
  readonly pathname: string;
  readonly resourceType: "fetch" | "xhr";
  readonly body: unknown;
}

const PUBLIC_REPLAY_ROUTES: readonly PublicReplayRoute[] = [
  {
    route: "/?scenario=scenario-b-route-leak",
    domainId: "network",
    sourceId: "scenario-b-route-leak",
    selectedExampleName: /Suspected route leak/,
    expectedEffectCapability: "sandbox-simulation",
    noReceiptText: /Not created\. This ephemeral public replay/i,
    noSimulationOrExecutionText: /Not run\. Public replay cannot approve a proposal/i,
  },
  {
    route: "/workbench/terraform?scenario=scenario-p-injected-pr-context",
    domainId: "terraform",
    sourceId: "scenario-p-injected-pr-context",
    selectedExampleName: /Retire an idle billing database replica/,
    expectedEffectCapability: "external-diff",
    noReceiptText: /Not created\. This ephemeral public replay/i,
    noSimulationOrExecutionText: /Unavailable and not run/i,
  },
  {
    route: "/workbench/kubernetes?scenario=scenario-m-selector-drift",
    domainId: "kubernetes",
    sourceId: "scenario-m-selector-drift",
    selectedExampleName: /Relabel the payments Deployment/,
    expectedEffectCapability: "sandbox-simulation",
    noReceiptText: /Not created\. This ephemeral public replay/i,
    noSimulationOrExecutionText: /no validated simulation result/i,
  },
] as const;

async function recordDataRequests(page: Page): Promise<DataRequest[]> {
  const requests: DataRequest[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    if (resourceType === "fetch" || resourceType === "xhr") {
      requests.push({
        method: request.method(),
        pathname: new URL(request.url()).pathname,
        resourceType,
        body: parseJsonBody(request.postData()),
      });
    }
    await route.continue();
  });
  return requests;
}

function parseJsonBody(body: string | null): unknown {
  if (body === null) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function expectNoAuthorityControls(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: AUTHORITY_CONTROL_NAME })).toHaveCount(0);
  await expect(page.getByRole("link", { name: AUTHORITY_CONTROL_NAME })).toHaveCount(0);
  await expect(page.getByRole("form", { name: AUTHORITY_CONTROL_NAME })).toHaveCount(0);
}

for (const replayRoute of PUBLIC_REPLAY_ROUTES) {
  test(`${replayRoute.domainId} deep-linked public replay exposes no durable authority or side-effect calls`, async ({
    page,
  }) => {
    const dataRequests = await recordDataRequests(page);

    await page.goto(replayRoute.route);

    await expect(
      page.getByRole("button", { name: replayRoute.selectedExampleName }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("No evaluated proposal is available yet."),
    ).toBeVisible();
    await expectNoAuthorityControls(page);
    expect(dataRequests).toEqual([]);

    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/reviews/analyze" &&
        response.request().method() === "POST"
      );
    });
    await page.getByRole("button", { name: "Run replay" }).click();
    const response = await responsePromise;
    const responseBody: unknown = await response.json();

    await expect(page.locator('[data-phase="BLOCKED"]')).toBeVisible();
    await expect(page.getByText(replayRoute.noReceiptText)).toBeVisible();
    await expect(
      page.getByText(replayRoute.noSimulationOrExecutionText),
    ).toBeVisible();
    await expect(page.getByText(/OIDC approver identity/i)).toHaveCount(0);
    await expect(page.getByText(/Signed receipts/i)).toHaveCount(0);
    await expectNoAuthorityControls(page);

    expect(dataRequests).toEqual([
      {
        resourceType: "fetch",
        method: "POST",
        pathname: "/api/reviews/analyze",
        body: {
          apiVersion: "v1",
          domainId: replayRoute.domainId,
          contractVersion: "2.0.0",
          sourceId: replayRoute.sourceId,
          analysisMode: "replay",
        },
      },
    ]);
    expect(
      dataRequests.filter((request) =>
        DISALLOWED_PUBLIC_DATA_PATH.test(request.pathname),
      ),
    ).toEqual([]);
    expect(responseBody).toMatchObject({
      apiVersion: "v1",
      result: {
        ok: true,
        domainId: replayRoute.domainId,
        sourceId: replayRoute.sourceId,
        session: {
          runtimeMode: "public-replay",
          analysisMode: "replay",
          capabilities: {
            durableDecision: false,
          },
        },
        provenance: {
          provider: null,
        },
        effectCapability: {
          kind: replayRoute.expectedEffectCapability,
        },
      },
    });
  });
}
