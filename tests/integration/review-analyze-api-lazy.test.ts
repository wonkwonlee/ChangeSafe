import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REVIEW_ANALYZE_API_VERSION,
  ReviewAnalyzeErrorV1Schema,
  ReviewAnalyzeSuccessV1Schema,
} from "@/lib/domain/api";
import { REVIEW_CONTRACT_VERSION } from "@/features/domains/review-contract";

function request(): Request {
  return new Request("http://localhost/api/reviews/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiVersion: REVIEW_ANALYZE_API_VERSION,
      domainId: "network",
      contractVersion: REVIEW_CONTRACT_VERSION,
      sourceId: "scenario-a-failover",
      analysisMode: "replay",
    }),
  });
}

async function importRouteWithLoader(
  loader: () => Promise<
    import("@/features/domains/registry").DomainRegistryEntry
  >,
) {
  vi.resetModules();
  const registryModule =
    await vi.importActual<typeof import("@/features/domains/registry")>(
      "@/features/domains/registry",
    );

  vi.doMock("@/features/domains/registry", () => ({
    ...registryModule,
    DOMAIN_REGISTRY: {
      entries: registryModule.DOMAIN_REGISTRY.entries,
      resolve(domainId: string, contractVersion: string) {
        const resolution = registryModule.DOMAIN_REGISTRY.resolve(
          domainId,
          contractVersion,
        );
        return resolution.ok ? { ...resolution, load: loader } : resolution;
      },
    },
  }));

  return import("@/app/api/reviews/analyze/route");
}

describe("POST /api/reviews/analyze lazy runtime loading", () => {
  afterEach(() => {
    vi.doUnmock("@/features/domains/registry");
    vi.resetModules();
  });

  it("awaits the resolved domain loader exactly once", async () => {
    const registryModule =
      await vi.importActual<typeof import("@/features/domains/registry")>(
        "@/features/domains/registry",
      );
    const resolution = registryModule.DOMAIN_REGISTRY.resolve(
      "network",
      REVIEW_CONTRACT_VERSION,
    );
    if (!resolution.ok) throw new Error("Network runtime must resolve");
    let loaderCalls = 0;
    const { POST } = await importRouteWithLoader(async () => {
      loaderCalls += 1;
      return resolution.load();
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(loaderCalls).toBe(1);
    expect(
      ReviewAnalyzeSuccessV1Schema.parse(await response.json()).result.domainId,
    ).toBe("network");
  });

  it("masks a rejected domain loader as an internal transport error", async () => {
    let loaderCalls = 0;
    const { POST } = await importRouteWithLoader(async () => {
      loaderCalls += 1;
      throw new Error("sensitive-loader-detail");
    });

    const response = await POST(request());
    const text = await response.text();
    const payload = ReviewAnalyzeErrorV1Schema.parse(JSON.parse(text));

    expect(response.status).toBe(500);
    expect(loaderCalls).toBe(1);
    expect(payload.result.error.code).toBe("INTERNAL");
    expect(text).not.toContain("sensitive-loader-detail");
  });
});
