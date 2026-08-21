import { expect, test, type Page } from "@playwright/test";

interface PublicWorkbench {
  readonly path: string;
  readonly mainName: string;
  readonly contextName: string;
  readonly authorityName: string;
  readonly initialOutcomeName: string;
  readonly blockedExampleName: RegExp;
  readonly evidenceHeading: string;
  readonly tableName: string;
  readonly tableColumnCount: number;
}

const PUBLIC_WORKBENCHES: readonly PublicWorkbench[] = [
  {
    path: "/",
    mainName: "Review canvas",
    contextName: "Review context",
    authorityName: "Review authority",
    initialOutcomeName: "INC-4821 — Degraded primary uplink",
    blockedExampleName: /INC-4977/,
    evidenceHeading: "Untrusted incident data",
    tableName: "Network nodes",
    tableColumnCount: 5,
  },
  {
    path: "/workbench/terraform",
    mainName: "Terraform review canvas",
    contextName: "Terraform review context",
    authorityName: "Terraform review authority",
    initialOutcomeName: "CHG-2340 — Scale up the checkout worker instance",
    blockedExampleName: /Retire an idle billing database replica/,
    evidenceHeading: "Resources and actions",
    tableName: "Terraform resource changes",
    tableColumnCount: 4,
  },
  {
    path: "/workbench/kubernetes",
    mainName: "Kubernetes review canvas",
    contextName: "Kubernetes review context",
    authorityName: "Kubernetes review authority",
    initialOutcomeName: "CHG-3201 — Scale up the product-catalog Deployment",
    blockedExampleName: /Relabel the payments Deployment/,
    evidenceHeading: "Current snapshot relationships",
    tableName: "Kubernetes Service selector relationships",
    tableColumnCount: 3,
  },
] as const;

async function expectVisibleKeyboardFocus(
  page: Page,
  target: ReturnType<Page["getByRole"]>,
): Promise<void> {
  await target.focus();
  await expect(target).toBeFocused();
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.outlineStyle} ${style.outlineWidth}`;
      }),
    )
    .toBe("solid 2px");
}

for (const workbench of PUBLIC_WORKBENCHES) {
  test.describe(`${workbench.path} hardening`, () => {
    test("uses the outcome as the page title without a later competing h1", async ({
      page,
    }) => {
      await page.goto(workbench.path);

      await expect(
        page.getByRole("heading", { level: 1, name: workbench.initialOutcomeName }),
      ).toHaveCount(1);
      await expect(
        page
          .getByRole("complementary", { name: workbench.contextName })
          .getByRole("heading", { level: 1 }),
      ).toHaveCount(0);
      await expect(page.locator('[data-phase="READY"]')).toBeVisible();
    });

    test("keeps selection and replay controls keyboard operable with visible focus", async ({
      page,
    }) => {
      await page.goto(workbench.path);

      const blockedExample = page.getByRole("button", {
        name: workbench.blockedExampleName,
      });
      await expectVisibleKeyboardFocus(page, blockedExample);
      await page.keyboard.press("Enter");
      await expect(blockedExample).toHaveAttribute("aria-pressed", "true");
      await expect(blockedExample).toBeFocused();

      const runReplay = page.getByRole("button", { name: "Run replay" });
      await expectVisibleKeyboardFocus(page, runReplay);
      await page.keyboard.press("Enter");
      const outcome = page.locator('[data-phase="BLOCKED"]');
      await expect(outcome).toBeVisible();
      await expect(outcome).toBeFocused();
    });

    test("reflows at a 200% equivalent viewport without document overflow", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 640, height: 720 });
      await page.goto(workbench.path);

      await expect(
        page.getByRole("main", { name: workbench.mainName }),
      ).toBeVisible();
      await expect(
        page.getByRole("complementary", { name: workbench.authorityName }),
      ).toBeVisible();
      const equivalentTable = page.getByRole("table", {
        name: workbench.tableName,
      });
      await expect(equivalentTable).toBeVisible();
      await expect(equivalentTable.locator('th[scope="col"]')).toHaveCount(
        workbench.tableColumnCount,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
    });

    test("removes nonessential control motion when reduced motion is requested", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(workbench.path);

      const motion = await page
        .getByRole("button", { name: "Run replay" })
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            animationDuration: Number.parseFloat(style.animationDuration),
            transitionDuration: Number.parseFloat(style.transitionDuration),
          };
        });
      expect(motion.animationDuration).toBeLessThanOrEqual(0.00001);
      expect(motion.transitionDuration).toBeLessThanOrEqual(0.00001);
    });

    test("orders outcome, findings, evidence, decision, receipt, then context on mobile", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(workbench.path);
      await page
        .getByRole("button", { name: workbench.blockedExampleName })
        .click();
      await page.getByRole("button", { name: "Run replay" }).click();
      await expect(page.locator('[data-phase="BLOCKED"]')).toBeVisible();

      const orderedRegions = [
        page.getByRole("heading", { level: 1 }),
        page.getByRole("heading", {
          level: 2,
          name:
            workbench.path === "/"
              ? "Policy results"
              : workbench.path === "/workbench/terraform"
                ? "Policy, reversibility, and context evidence"
                : "Image, security, selector, and protected-resource evidence",
        }),
        page.getByRole("heading", {
          level: 2,
          name: workbench.evidenceHeading,
        }),
        page.getByRole("heading", { level: 2, name: "Decision" }),
        page.getByRole("heading", { level: 2, name: "Receipt" }),
        page.getByRole("complementary", { name: workbench.contextName }),
      ];
      const positions = await Promise.all(
        orderedRegions.map(async (region) => {
          const box = await region.boundingBox();
          expect(box).not.toBeNull();
          return box?.y ?? Number.NaN;
        }),
      );

      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      const elements = await Promise.all(
        orderedRegions.map((region) => region.elementHandle()),
      );
      for (let index = 0; index < elements.length - 1; index += 1) {
        const current = elements[index];
        const next = elements[index + 1];
        expect(current).not.toBeNull();
        expect(next).not.toBeNull();
        if (!current || !next) continue;
        expect(
          await current.evaluate(
            (element, following) =>
              (element.compareDocumentPosition(following) &
                Node.DOCUMENT_POSITION_FOLLOWING) !==
              0,
            next,
          ),
        ).toBe(true);
      }
    });
  });
}

test("keeps a schema-valid 10-change Terraform plan searchable while bounding rendered rows", async ({
  page,
}) => {
  await page.goto("/workbench/terraform");
  await page.getByRole("button", { name: /Large plan boundary/ }).click();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "10 actionable resource changes",
    }),
  ).toBeVisible();
  await expect(page.getByText("Showing 1–8 of 10 changes.")).toBeVisible();
  const table = page.getByRole("table", { name: "Terraform resource changes" });
  await expect(table.locator("tbody tr")).toHaveCount(8);

  await page
    .getByLabel("Search all Terraform changes")
    .fill("worker_009");
  await expect(
    // exact: without it this also matches the row's "Inspect values for
    // module.boundary.aws_instance.worker_009" <summary>, a strict-mode
    // violation.
    page.getByText("module.boundary.aws_instance.worker_009", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Showing 1–1 of 1 matching changes from 10 total."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(
    page.locator('[data-phase="APPROVAL_REQUIRED"]'),
  ).toBeVisible();
  await expect(
    page.getByText(/Previewing 12,000 of .* characters\./),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show complete Terraform proposal JSON" })
    .click();
  await expect(
    page.getByLabel("Terraform proposal JSON"),
  ).toContainText("module.boundary.aws_instance.worker_009");
});

test("keeps large Kubernetes inventory, nested selector matches, and proposal operations searchable", async ({
  page,
}) => {
  await page.goto("/workbench/kubernetes");
  // Every scenario carries its own small snapshot, so the large inventory is
  // reachable only through the fixture authored to exercise these bounds.
  await page.getByRole("button", { name: /Large manifest boundary/ }).click();

  await expect(
    page.getByText("Showing 1–8 of 154 resources."),
  ).toBeVisible();
  await page
    .getByLabel("Search all Kubernetes resources")
    .fill("boundary-worker-149");
  await expect(
    page
      .getByRole("region", { name: "154 captured offline resources" })
      .getByText("Deployment demo/boundary-worker-149"),
  ).toBeVisible();

  await expect(
    page.getByText("Showing 1–20 of 150 workloads."),
  ).toBeVisible();
  const workerRelation = page.getByRole("row", {
    name: /Service demo\/boundary-workers/,
  });
  await workerRelation
    .getByLabel("Search matching workloads for Service demo/boundary-workers")
    .fill("boundary-worker-149");
  await expect(
    workerRelation.getByText("Deployment demo/boundary-worker-149", {
      exact: true,
    }),
  ).toBeVisible();

  await expect(
    page.getByText("Showing 1–8 of 10 operations."),
  ).toBeVisible();
  await page
    .getByLabel("Search all Kubernetes proposal operations")
    .fill("boundary-proposed-009");
  await expect(
    page.getByText("Deployment demo/boundary-proposed-009", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.locator('[data-phase="BLOCKED"]')).toBeVisible();
  await expect(
    page.getByText(/Previewing 12,000 of .* characters\./),
  ).toBeVisible();
});
