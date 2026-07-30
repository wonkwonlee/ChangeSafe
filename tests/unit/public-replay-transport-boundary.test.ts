import { afterEach, describe, expect, it, vi } from "vitest";

describe("public replay transport dependency boundary", () => {
  afterEach(() => {
    vi.doUnmock("@changesafe/domain-network");
    vi.doUnmock("@/lib/domain/api");
    vi.resetModules();
  });

  it("imports without loading the Network domain or legacy API module", async () => {
    const importedModules: string[] = [];
    vi.doMock("@changesafe/domain-network", async () => {
      importedModules.push("@changesafe/domain-network");
      return vi.importActual("@changesafe/domain-network");
    });
    vi.doMock("@/lib/domain/api", async () => {
      importedModules.push("@/lib/domain/api");
      return vi.importActual("@/lib/domain/api");
    });
    vi.resetModules();

    const transportModule = await import(
      "@/features/reviews/publicReplayTransport"
    );

    expect(transportModule.publicReplayTransport).toBeTypeOf("function");
    expect(importedModules).toEqual([]);
  });
});
