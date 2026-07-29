import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const SOURCE_MODULE_PATTERN = /\.[cm]?[jt]sx?$/;
const PRESENTATION_PATH_PATTERN = /(?:^|\/)(?:app|components|features)(?:\/|$)/;
const BROWSER_UI_PACKAGES = [
  "client-only",
  "next",
  "react",
  "react-dom",
  "@vercel/speed-insights",
] as const;

function isBrowserUiModule(specifier: string): boolean {
  return BROWSER_UI_PACKAGES.some(
    (packageName) =>
      specifier === packageName || specifier.startsWith(`${packageName}/`),
  );
}

function isForbiddenPresentationModule(specifier: string): boolean {
  return (
    PRESENTATION_PATH_PATTERN.test(specifier) || isBrowserUiModule(specifier)
  );
}

async function sourceModules(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const modules = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceModules(entryPath);
      }
      return SOURCE_MODULE_PATTERN.test(entry.name) ? [entryPath] : [];
    }),
  );
  return modules.flat().sort();
}

function importedModules(
  filePath: string,
  source: string,
): ReadonlyArray<{ line: number; specifier: string }> {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: Array<{ line: number; specifier: string }> = [];

  function record(node: ts.StringLiteralLike): void {
    imports.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        .line + 1,
      specifier: node.text,
    });
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      record(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const [specifier] = node.arguments;
      if (specifier && ts.isStringLiteralLike(specifier)) {
        record(specifier);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

export async function findPresentationBoundaryViolations(
  repositoryRoot: string,
): Promise<string[]> {
  const packagesRoot = path.join(repositoryRoot, "packages");
  const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
  const protectedSourceRoots = packageEntries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name === "core" || entry.name.startsWith("domain-")),
    )
    .map((entry) => path.join(packagesRoot, entry.name, "src"));
  const files = (await Promise.all(protectedSourceRoots.map(sourceModules)))
    .flat()
    .sort();
  const violations: string[] = [];

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    const relativePath = path
      .relative(repositoryRoot, filePath)
      .split(path.sep)
      .join("/");
    for (const importedModule of importedModules(filePath, source)) {
      if (isForbiddenPresentationModule(importedModule.specifier)) {
        violations.push(
          `${relativePath}:${importedModule.line} imports forbidden presentation module "${importedModule.specifier}"`,
        );
      }
    }
  }

  return violations;
}
