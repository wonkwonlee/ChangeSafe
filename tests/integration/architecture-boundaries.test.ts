import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findPresentationBoundaryViolations } from "../helpers/architecture-boundaries";

const temporaryRepositories: string[] = [];

async function createRepositoryFixture(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "changesafe-boundary-"));
  temporaryRepositories.push(root);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, source, "utf8");
    }),
  );

  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("core and domain presentation boundaries", () => {
  it("reports app presentation imports with the offending source path", async () => {
    const root = await createRepositoryFixture({
      "packages/core/src/proposal.ts": [
        'import { review } from "@/features/review";',
        'export { Console } from "../../../components/console";',
        'const route = import("../../../app/review/page");',
      ].join("\n"),
      "packages/domain-network/src/client.ts":
        'import { createRoot } from "react-dom/client";',
    });

    await expect(findPresentationBoundaryViolations(root)).resolves.toEqual([
      'packages/core/src/proposal.ts:1 imports forbidden presentation module "@/features/review"',
      'packages/core/src/proposal.ts:2 imports forbidden presentation module "../../../components/console"',
      'packages/core/src/proposal.ts:3 imports forbidden presentation module "../../../app/review/page"',
      'packages/domain-network/src/client.ts:1 imports forbidden presentation module "react-dom/client"',
    ]);
  });

  it("scans only core and domain source modules", async () => {
    const root = await createRepositoryFixture({
      "app/page.tsx":
        'import { networkDomain } from "@changesafe/domain-network";',
      "packages/core/src/index.ts": 'export { z } from "zod";',
      "packages/domain-network/src/adapter.ts":
        'import type { DomainAdapter } from "@changesafe/core";',
      "packages/domain-network/dist/index.js":
        'import { Console } from "../../../components/console";',
    });

    await expect(findPresentationBoundaryViolations(root)).resolves.toEqual([]);
  });

  it("keeps the repository free of core or domain presentation imports", async () => {
    await expect(
      findPresentationBoundaryViolations(process.cwd()),
    ).resolves.toEqual([]);
  });
});
