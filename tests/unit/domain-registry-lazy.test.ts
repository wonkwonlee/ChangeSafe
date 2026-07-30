import { afterEach, describe, expect, it, vi } from "vitest";

const domainModules = [
  "@changesafe/domain-network",
  "@changesafe/domain-terraform",
  "@changesafe/domain-kubernetes/offline",
] as const;

describe("lazy domain registry loading", () => {
  afterEach(() => {
    vi.doUnmock("@changesafe/domain-network");
    vi.doUnmock("@changesafe/domain-terraform");
    vi.doUnmock("@changesafe/domain-kubernetes/offline");
    vi.resetModules();
  });

  it.each([
    ["network", "@changesafe/domain-network"],
    ["terraform", "@changesafe/domain-terraform"],
    ["kubernetes", "@changesafe/domain-kubernetes/offline"],
  ] as const)(
    "imports only the %s runtime after its validated resolution is loaded",
    async (domainId, expectedModule) => {
      const importedModules: string[] = [];

      for (const moduleId of domainModules) {
        vi.doMock(moduleId, async () => {
          importedModules.push(moduleId);
          return vi.importActual(moduleId);
        });
      }
      vi.resetModules();

      const [{ DOMAIN_REGISTRY }, { REVIEW_CONTRACT_VERSION }] =
        await Promise.all([
          import("@/features/domains/registry"),
          import("@/features/domains/review-contract"),
        ]);

      expect(importedModules).toEqual([]);

      const resolution = DOMAIN_REGISTRY.resolve(
        domainId,
        REVIEW_CONTRACT_VERSION,
      );
      expect(resolution.ok).toBe(true);
      expect(importedModules).toEqual([]);
      if (!resolution.ok) return;

      const entry = await resolution.load();

      expect(entry.runtime.domainId).toBe(domainId);
      expect(importedModules).toEqual([expectedModule]);
    },
  );

  it.each([
    ["network", "@changesafe/domain-network"],
    ["terraform", "@changesafe/domain-terraform"],
    ["kubernetes", "@changesafe/domain-kubernetes/offline"],
  ] as const)(
    "loads only the %s adapter when building its policy coverage catalog",
    async (domainId, expectedModule) => {
      const importedModules: string[] = [];

      for (const moduleId of domainModules) {
        vi.doMock(moduleId, async () => {
          importedModules.push(moduleId);
          return vi.importActual(moduleId);
        });
      }
      vi.resetModules();

      const { loadDomainCoverageCatalog } = await import(
        "@/features/domains/registry"
      );
      expect(importedModules).toEqual([]);

      const catalog = await loadDomainCoverageCatalog(domainId);

      expect(catalog.registration.domainId).toBe(domainId);
      expect(catalog.runtime.policyCoverage.orderedPolicyIds.length).toBeGreaterThan(
        0,
      );
      expect(importedModules).toEqual([expectedModule]);
    },
  );
});
