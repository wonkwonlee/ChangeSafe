import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RETIRED_SURFACES = [
  "app/workbench/page.tsx",
  "app/api/analyze/route.ts",
  "components/ChangeSafeApp.tsx",
  "components/useWorkflow.ts",
  "features/domains/network/useNetworkWorkflow.ts",
  "lib/ai/replay.ts",
  "lib/rate-limit.ts",
] as const;

describe("vNext default-route cutover", () => {
  it("retires the Network-only compatibility route and facade", () => {
    for (const relativePath of RETIRED_SURFACES) {
      expect(existsSync(relativePath), relativePath).toBe(false);
    }
  });

  it("keeps the three non-default workbench routes intact", () => {
    for (const relativePath of [
      "app/workbench/terraform/page.tsx",
      "app/workbench/kubernetes/page.tsx",
      "app/workbench/self-hosted/page.tsx",
    ]) {
      expect(existsSync(relativePath), relativePath).toBe(true);
    }
  });

  it("makes the default page the Network public replay entry", () => {
    const source = readFileSync("app/page.tsx", "utf8");
    expect(source).toContain(
      'import { ReviewWorkbenchShell } from "@/components/ReviewWorkbenchShell"',
    );
    expect(source).toContain('loadDomainCoverageCatalog("network")');
    expect(source).not.toContain("ChangeSafeApp");
  });

  it("removes the retired analyze wire contract while preserving current APIs", () => {
    const source = readFileSync("lib/domain/api.ts", "utf8");

    expect(source).not.toContain("AnalyzeRequestSchema");
    expect(source).not.toContain("AnalyzeSuccessSchema");
    expect(source).not.toContain("AnalyzeErrorSchema");
    expect(source).toContain("StatusResponseSchema");
    expect(source).toContain("ReviewAnalyzeRequestV1Schema");
  });

  it("stops advertising an app-level live analysis capability in /api/status", async () => {
    const { StatusResponseSchema } = await import("../../lib/domain/api");
    const { GET } = await import("../../app/api/status/route");

    expect(
      StatusResponseSchema.safeParse({
        appVersion: "0.0.0-test",
        liveAvailable: true,
      }).success,
    ).toBe(false);

    const body: unknown = await GET().json();
    expect(StatusResponseSchema.parse(body)).toEqual({
      appVersion: expect.any(String) as unknown as string,
    });
    expect(Object.keys(body as object)).toEqual(["appVersion"]);

    const routeSource = readFileSync("app/api/status/route.ts", "utf8");
    expect(routeSource).not.toContain("liveAvailable");
    expect(routeSource).not.toContain("@/lib/ai/live");
  });

  it("removes the retired legacy-local contract and lifecycle authority", () => {
    const contract = readFileSync("features/domains/review-contract.ts", "utf8");
    const controller = readFileSync("features/reviews/controller.ts", "utf8");

    expect(contract).not.toContain("legacy-local");
    expect(controller).not.toContain("legacy-local");
  });
});
