import { expect, test, type Page } from "@playwright/test";

interface PublicWorkbench {
  readonly path: string;
  readonly mainName: string;
  readonly contextName: string;
  readonly authorityName: string;
  readonly blockedExampleName: RegExp;
  readonly evidenceHeading: string;
  readonly tableName: string;
  readonly tableColumnCount: number;
}

const PUBLIC_WORKBENCHES: readonly PublicWorkbench[] = [
  {
    path: "/workbench",
    mainName: "Review canvas",
    contextName: "Review context",
    authorityName: "Review authority",
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
    blockedExampleName: /Protected resource with injected PR text/,
    evidenceHeading: "Resources and actions",
    tableName: "Terraform resource changes",
    tableColumnCount: 4,
  },
  {
    path: "/workbench/kubernetes",
    mainName: "Kubernetes review canvas",
    contextName: "Kubernetes review context",
    authorityName: "Kubernetes review authority",
    blockedExampleName: /Service selector break/,
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
      const outcome = page.getByRole("heading", {
        level: 2,
        name: "BLOCKED",
      });
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
      await expect(
        page.getByRole("heading", { level: 2, name: "BLOCKED" }),
      ).toBeVisible();

      const orderedRegions = [
        page.getByRole("heading", { level: 2, name: "BLOCKED" }),
        page.getByRole("heading", {
          level: 3,
          name:
            workbench.path === "/workbench"
              ? "Policy results"
              : workbench.path === "/workbench/terraform"
                ? "Policy, reversibility, and context evidence"
                : "Image, security, selector, and protected-resource evidence",
        }),
        page.getByRole("heading", {
          level: 3,
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
