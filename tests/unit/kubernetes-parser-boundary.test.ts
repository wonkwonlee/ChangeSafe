import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const fixtureModule = path.join(
  repositoryRoot,
  "features/domains/kubernetes/fixtures.ts",
);
const exampleModule = path.join(
  repositoryRoot,
  "features/domains/kubernetes/examples.ts",
);
const registryModule = path.join(
  repositoryRoot,
  "features/domains/registry.ts",
);
const kubernetesRootModule = path.join(
  repositoryRoot,
  "packages/domain-kubernetes/src/index.ts",
);
const offlineModule = path.join(
  repositoryRoot,
  "packages/domain-kubernetes/src/offline.ts",
);
const yamlParserModule = path.join(
  repositoryRoot,
  "packages/domain-kubernetes/src/manifests.ts",
);

function importedSpecifiers(sourcePath: string, source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function resolveInternalSpecifier(fromPath: string, specifier: string): string | null {
  if (specifier === "@changesafe/domain-kubernetes/offline") {
    return offlineModule;
  }
  if (specifier === "@changesafe/domain-kubernetes") {
    return kubernetesRootModule;
  }
  if (!specifier.startsWith(".")) {
    return null;
  }
  // Bundled scenario data. JSON has no imports of its own, so it cannot
  // extend the graph toward a parser; walking into it would only fail to
  // resolve a "<file>.json.ts" that never exists.
  if (specifier.endsWith(".json")) {
    return null;
  }
  return path.resolve(path.dirname(fromPath), `${specifier}.ts`);
}

async function reachableModules(entryPath: string): Promise<ReadonlySet<string>> {
  const seen = new Set<string>();
  const pending = [entryPath];

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (!modulePath || seen.has(modulePath)) {
      continue;
    }
    seen.add(modulePath);
    const source = await readFile(modulePath, "utf8");
    for (const specifier of importedSpecifiers(modulePath, source)) {
      const resolved = resolveInternalSpecifier(modulePath, specifier);
      if (resolved) {
        pending.push(resolved);
      }
    }
  }

  return seen;
}

describe("Kubernetes typed-fixture parser boundary", () => {
  it.each([
    ["fixture", fixtureModule],
    ["example descriptor", exampleModule],
    ["registry Kubernetes runtime loader", registryModule],
  ])("keeps the app-facing Kubernetes %s graph parser-free", async (_name, entryModule) => {
    const source = await readFile(entryModule, "utf8");
    const reachable = await reachableModules(entryModule);

    expect(source).toContain("@changesafe/domain-kubernetes/offline");
    expect(source).not.toContain('"@changesafe/domain-kubernetes"');
    expect(reachable).toContain(offlineModule);
    expect(reachable).not.toContain(yamlParserModule);
  });
});
