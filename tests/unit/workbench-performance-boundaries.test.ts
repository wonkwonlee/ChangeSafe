import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  MAX_JSON_PREVIEW_CHARS,
  MAX_VISIBLE_NESTED_ITEMS,
  MAX_VISIBLE_OFFLINE_ITEMS,
  boundOfflineCollection,
  searchAndPageOfflineCollection,
  serializeJsonPreview,
} from "@/features/domains/presentation-limit";

interface ModuleReference {
  readonly kind: "dynamic" | "static";
  readonly specifier: string;
}

interface RuntimeDependencyGraph {
  readonly localFiles: ReadonlySet<string>;
  readonly packageSpecifiers: ReadonlySet<string>;
}

const DOMAIN_RUNTIME_MODULES = [
  "@changesafe/domain-network",
  "@changesafe/domain-terraform",
  "@changesafe/domain-kubernetes/offline",
] as const;

function moduleReferences(
  relativePath: string,
  sourceOverride?: string,
): readonly ModuleReference[] {
  const filePath = path.resolve(relativePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceOverride ?? readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const references: ModuleReference[] = [];

  function importHasRuntimeValue(node: ts.ImportDeclaration): boolean {
    const clause = node.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    if (clause.name) return true;
    if (!clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) {
      return true;
    }
    return (
      clause.namedBindings.elements.length === 0 ||
      clause.namedBindings.elements.some((element) => !element.isTypeOnly)
    );
  }

  function exportHasRuntimeValue(node: ts.ExportDeclaration): boolean {
    if (node.isTypeOnly) return false;
    if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
      return true;
    }
    return (
      node.exportClause.elements.length === 0 ||
      node.exportClause.elements.some((element) => !element.isTypeOnly)
    );
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      (ts.isImportDeclaration(node)
        ? importHasRuntimeValue(node)
        : exportHasRuntimeValue(node))
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

const LOCAL_MODULE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
] as const;

function resolveLocalModule(
  importerPath: string,
  specifier: string,
  sourceOverrides: ReadonlyMap<string, string>,
): string | null {
  const unresolved =
    specifier.startsWith("@/")
      ? path.resolve(specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(importerPath), specifier)
        : null;
  if (!unresolved) return null;

  for (const extension of LOCAL_MODULE_EXTENSIONS) {
    const candidate = `${unresolved}${extension}`;
    if (sourceOverrides.has(candidate)) return candidate;
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next TypeScript/JavaScript resolution candidate.
    }
  }
  throw new Error(
    `Unable to resolve local module "${specifier}" imported by "${importerPath}"`,
  );
}

function collectStaticRuntimeDependencyGraph(
  entryPath: string,
  sourceOverrides: ReadonlyMap<string, string> = new Map(),
): RuntimeDependencyGraph {
  const pending = [path.resolve(entryPath)];
  const localFiles = new Set<string>();
  const packageSpecifiers = new Set<string>();

  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (!currentPath || localFiles.has(currentPath)) continue;
    localFiles.add(currentPath);

    const references = moduleReferences(
      currentPath,
      sourceOverrides.get(currentPath),
    ).filter((reference) => reference.kind === "static");
    for (const reference of references) {
      const resolved = resolveLocalModule(
        currentPath,
        reference.specifier,
        sourceOverrides,
      );
      if (resolved) {
        pending.push(resolved);
      } else {
        packageSpecifiers.add(reference.specifier);
      }
    }
  }

  return {
    localFiles,
    packageSpecifiers,
  };
}

function hasDomainPackage(
  graph: RuntimeDependencyGraph,
  packageRoot: string,
): boolean {
  const normalizedRoot = packageRoot.replace(/\/+$/, "");
  return [...graph.packageSpecifiers].some(
    (specifier) =>
      specifier === normalizedRoot ||
      specifier.startsWith(`${normalizedRoot}/`),
  );
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

  it("detects a foreign-domain import introduced through an intermediate local module", () => {
    const shellPath = path.resolve("components/ReviewWorkbenchShell.tsx");
    const originalShell = readFileSync(shellPath, "utf8");
    const graph = collectStaticRuntimeDependencyGraph(
      "app/workbench/page.tsx",
      new Map([
        [
          shellPath,
          `${originalShell}\nimport "@/features/domains/terraform/examples";\n`,
        ],
      ]),
    );

    expect(graph.packageSpecifiers).toContain("@changesafe/domain-terraform");
  });

  it("ignores statement and inline type-only imports and exports", () => {
    const references = moduleReferences(
      "components/ReviewWorkbenchShell.tsx",
      `
        import type { TerraformInput } from "@changesafe/domain-terraform";
        import { type TerraformPlan } from "@changesafe/domain-terraform/offline";
        export type { TerraformPolicyPack } from "@changesafe/domain-terraform";
        export { type TerraformFinding } from "@changesafe/domain-terraform/internal";
      `,
    );

    expect(references).toEqual([]);
  });

  it("retains mixed runtime imports and exports while ignoring their type-only bindings", () => {
    const references = moduleReferences(
      "components/ReviewWorkbenchShell.tsx",
      `
        import { terraformDomain, type TerraformInput } from "@changesafe/domain-terraform";
        export { normalizePlan, type TerraformPlan } from "@changesafe/domain-terraform/offline";
      `,
    );

    expect(references).toEqual([
      { kind: "static", specifier: "@changesafe/domain-terraform" },
      { kind: "static", specifier: "@changesafe/domain-terraform/offline" },
    ]);
  });

  it("treats a package root and every normalized subpath as the same domain runtime", () => {
    const shellPath = path.resolve("components/ReviewWorkbenchShell.tsx");
    const originalShell = readFileSync(shellPath, "utf8");
    const graph = collectStaticRuntimeDependencyGraph(
      "app/workbench/page.tsx",
      new Map([
        [
          shellPath,
          `${originalShell}\nimport "@changesafe/domain-terraform/internal/adapter";\n`,
        ],
      ]),
    );

    expect(hasDomainPackage(graph, "@changesafe/domain-terraform")).toBe(true);
    expect(hasDomainPackage(graph, "@changesafe/domain-terraform-extra")).toBe(
      false,
    );
  });

  it.each([
    [
      "app/workbench/page.tsx",
      ["@changesafe/domain-terraform", "@changesafe/domain-kubernetes/offline"],
    ],
    [
      "app/workbench/terraform/page.tsx",
      ["@changesafe/domain-network", "@changesafe/domain-kubernetes/offline"],
    ],
    [
      "app/workbench/kubernetes/page.tsx",
      ["@changesafe/domain-network", "@changesafe/domain-terraform"],
    ],
  ] as const)(
    "keeps the resolved static runtime graph for %s free of foreign domain packages",
    (entryPath, forbiddenPackages) => {
      const graph = collectStaticRuntimeDependencyGraph(entryPath);
      expect(graph.localFiles.size).toBeGreaterThan(1);
      for (const forbiddenPackage of forbiddenPackages) {
        expect(hasDomainPackage(graph, forbiddenPackage)).toBe(false);
      }
    },
  );

  it("bounds a schema-maximum offline collection without mutating its input", () => {
    const input = Array.from({ length: 5_000 }, (_, index) => ({
      id: `resource-${index}`,
    }));

    const bounded = boundOfflineCollection(input);

    expect(MAX_VISIBLE_OFFLINE_ITEMS).toBe(8);
    expect(bounded.items).toHaveLength(MAX_VISIBLE_OFFLINE_ITEMS);
    expect(bounded.items[0]).toBe(input[0]);
    expect(bounded.items.at(-1)).toBe(input[MAX_VISIBLE_OFFLINE_ITEMS - 1]);
    expect(bounded.totalCount).toBe(5_000);
    expect(bounded.hiddenCount).toBe(4_992);
    expect(input).toHaveLength(5_000);
  });

  it("searches the complete collection before applying a deterministic page bound", () => {
    const input = Array.from({ length: 250 }, (_, index) => ({
      id: `resource-${index.toString().padStart(3, "0")}`,
    }));

    const firstPage = searchAndPageOfflineCollection(
      input,
      "",
      (item) => item.id,
      0,
    );
    const hiddenMatch = searchAndPageOfflineCollection(
      input,
      "resource-249",
      (item) => item.id,
      0,
    );

    expect(firstPage.items).toHaveLength(MAX_VISIBLE_OFFLINE_ITEMS);
    expect(firstPage).toMatchObject({
      totalCount: 250,
      matchingCount: 250,
      pageIndex: 0,
      pageCount: 32,
      startNumber: 1,
      endNumber: 8,
    });
    expect(hiddenMatch.items).toEqual([input[249]]);
    expect(hiddenMatch).toMatchObject({
      totalCount: 250,
      matchingCount: 1,
      pageIndex: 0,
      pageCount: 1,
      startNumber: 1,
      endNumber: 1,
    });
  });

  it("uses a smaller nested-association page and a bounded expandable JSON preview", () => {
    const associations = Array.from({ length: 150 }, (_, index) => ({
      id: `workload-${index}`,
    }));
    const nestedPage = searchAndPageOfflineCollection(
      associations,
      "",
      (item) => item.id,
      0,
      MAX_VISIBLE_NESTED_ITEMS,
    );
    const json = serializeJsonPreview({
      operations: Array.from({ length: 500 }, (_, index) => ({
        path: `/resources/${index}`,
        reason: "schema-valid deterministic proposal evidence",
      })),
    });

    expect(nestedPage.items).toHaveLength(MAX_VISIBLE_NESTED_ITEMS);
    expect(nestedPage.pageCount).toBeGreaterThan(1);
    expect(json.fullText.length).toBeGreaterThan(MAX_JSON_PREVIEW_CHARS);
    expect(json.previewText.length).toBeLessThanOrEqual(
      MAX_JSON_PREVIEW_CHARS + 2,
    );
    expect(json.truncated).toBe(true);
  });
});
