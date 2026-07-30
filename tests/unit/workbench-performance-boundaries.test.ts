import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  MAX_VISIBLE_OFFLINE_ITEMS,
  boundOfflineCollection,
} from "@/features/domains/presentation-limit";

interface ModuleReference {
  readonly kind: "dynamic" | "static";
  readonly specifier: string;
}

const DOMAIN_RUNTIME_MODULES = [
  "@changesafe/domain-network",
  "@changesafe/domain-terraform",
  "@changesafe/domain-kubernetes/offline",
] as const;

function moduleReferences(relativePath: string): readonly ModuleReference[] {
  const filePath = path.resolve(relativePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const references: ModuleReference[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        kind: "static",
        specifier: node.moduleSpecifier.text,
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [specifier] = node.arguments;
      if (specifier && ts.isStringLiteralLike(specifier)) {
        references.push({ kind: "dynamic", specifier: specifier.text });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

describe("workbench deterministic performance boundaries", () => {
  it("keeps every domain runtime behind the registry's lazy import boundary", () => {
    const references = moduleReferences("features/domains/registry.ts");
    const runtimeReferences = references.filter((reference) =>
      DOMAIN_RUNTIME_MODULES.includes(
        reference.specifier as (typeof DOMAIN_RUNTIME_MODULES)[number],
      ),
    );

    expect(runtimeReferences).toEqual(
      DOMAIN_RUNTIME_MODULES.map((specifier) => ({
        kind: "dynamic",
        specifier,
      })),
    );
  });

  it.each([
    ["app/workbench/page.tsx", "@/components/ReviewWorkbenchShell"],
    [
      "app/workbench/terraform/page.tsx",
      "@/components/TerraformWorkbenchShell",
    ],
    [
      "app/workbench/kubernetes/page.tsx",
      "@/components/KubernetesWorkbenchShell",
    ],
  ] as const)(
    "keeps %s statically bound to only its own client shell",
    (pagePath, expectedShell) => {
      const shellImports = moduleReferences(pagePath)
        .filter(
          (reference) =>
            reference.kind === "static" &&
            reference.specifier.startsWith("@/components/") &&
            reference.specifier.endsWith("WorkbenchShell"),
        )
        .map((reference) => reference.specifier);

      expect(shellImports).toEqual([expectedShell]);
    },
  );

  it("bounds a schema-maximum offline collection without mutating its input", () => {
    const input = Array.from({ length: 5_000 }, (_, index) => ({
      id: `resource-${index}`,
    }));

    const bounded = boundOfflineCollection(input);

    expect(MAX_VISIBLE_OFFLINE_ITEMS).toBe(100);
    expect(bounded.items).toHaveLength(MAX_VISIBLE_OFFLINE_ITEMS);
    expect(bounded.items[0]).toBe(input[0]);
    expect(bounded.items.at(-1)).toBe(input[MAX_VISIBLE_OFFLINE_ITEMS - 1]);
    expect(bounded.totalCount).toBe(5_000);
    expect(bounded.hiddenCount).toBe(4_900);
    expect(input).toHaveLength(5_000);
  });
});
