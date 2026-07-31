import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const PUBLIC_WORKBENCH_BUDGET_BYTES = 1_310_720;

const KUBERNETES_POLICY_MARKERS = Object.freeze([
  "K8S_WORKLOAD_AVAILABILITY",
  "K8S_PRIVILEGE_ESCALATION",
  "K8S_SERVICE_SELECTOR",
  "K8S_MUTABLE_IMAGE",
  "K8S_PROTECTED_RESOURCE",
]);

export const CLIENT_BUNDLE_MARKER_CONTRACTS = Object.freeze({
  aiPackageRoot: "@changesafe/ai",
  promptMarkers: Object.freeze([
    "<untrusted_incident_data>",
    "</untrusted_incident_data>",
  ]),
  providerEndpointMarkers: Object.freeze([
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "http://127.0.0.1:11434",
  ]),
});

export const PUBLIC_WORKBENCH_ROUTES = Object.freeze([
  Object.freeze({
    route: "/",
    htmlPath: "server/app/index.html",
    forbiddenRuntimeMarkers: Object.freeze([
      "DESTRUCTIVE_OP",
      "REVERSIBILITY",
      ...KUBERNETES_POLICY_MARKERS,
    ]),
  }),
  Object.freeze({
    route: "/workbench/terraform",
    htmlPath: "server/app/workbench/terraform.html",
    forbiddenRuntimeMarkers: Object.freeze([
      "MGMT_REACHABILITY",
      ...KUBERNETES_POLICY_MARKERS,
    ]),
  }),
  Object.freeze({
    route: "/workbench/kubernetes",
    htmlPath: "server/app/workbench/kubernetes.html",
    forbiddenRuntimeMarkers: Object.freeze([
      "MGMT_REACHABILITY",
      "DESTRUCTIVE_OP",
      "REVERSIBILITY",
    ]),
  }),
  // The self-hosted queue is deliberately cross-domain: it lists reviews from
  // every registered domain and names Kubernetes explicitly to refuse it, so
  // every domain's policy identifiers legitimately reach this graph. Claiming
  // a domain-isolation contract here would be a check that only ever passed
  // by accident. What this route is held to is the shared byte budget and the
  // server-only/credential sweep every emitted asset gets.
  Object.freeze({
    route: "/workbench/self-hosted",
    htmlPath: "server/app/workbench/self-hosted.html",
    forbiddenRuntimeMarkers: Object.freeze([]),
  }),
]);

/** Routes that carry a single-domain isolation claim, and must prove it. */
export const DOMAIN_ISOLATED_PUBLIC_ROUTES = Object.freeze([
  "/",
  "/workbench/terraform",
  "/workbench/kubernetes",
]);

const PUBLIC_ROUTE_ENTRY_PATHS = Object.freeze([
  "app/page.tsx",
  "app/workbench/terraform/page.tsx",
  "app/workbench/kubernetes/page.tsx",
  "app/workbench/self-hosted/page.tsx",
]);

function failure(message) {
  return new Error(`public client bundle verification failed: ${message}`);
}

function isStrictDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function isSameOrDescendant(parent, candidate) {
  return parent === candidate || isStrictDescendant(parent, candidate);
}

function initialClientScriptSources(html, route) {
  const sources = [];
  for (const match of html.matchAll(
    /<script\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/gi,
  )) {
    const source = match[2];
    if (!source?.startsWith("/_next/static/")) continue;
    if (
      !/^\/_next\/static\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.js$/.test(
        source,
      ) ||
      source.split("/").includes("..")
    ) {
      throw failure(`${route} contains an invalid client script path`);
    }
    sources.push(source);
  }

  if (sources.length === 0) {
    throw failure(`${route} contains no initial client scripts`);
  }
  return sources.sort();
}

function resolveRouteHtml(buildRoot, realBuildRoot, htmlPath, route) {
  const requestedPath = path.resolve(buildRoot, htmlPath);
  let realPath;
  try {
    realPath = realpathSync(requestedPath);
  } catch {
    throw failure(`${route} emitted HTML is unavailable`);
  }
  if (!isStrictDescendant(realBuildRoot, realPath)) {
    throw failure(`${route} contains an invalid emitted HTML path`);
  }
  return realPath;
}

function resolveClientScript(buildRoot, realStaticRoot, source, route) {
  const relativePath = source.slice("/_next/static/".length);
  const requestedPath = path.resolve(buildRoot, "static", relativePath);
  let realPath;
  try {
    realPath = realpathSync(requestedPath);
  } catch {
    throw failure(`${route} references a missing client script`);
  }
  if (!isStrictDescendant(realStaticRoot, realPath)) {
    throw failure(`${route} contains an invalid client script path`);
  }
  return realPath;
}

/**
 * Every emitted extension a credential could survive in.
 *
 * A secret does not become safe by landing in a source map, a build manifest,
 * or a stylesheet instead of a script — all of them are served to any browser
 * that asks. Scanning only `.js` would have been a coverage claim the sweep
 * did not actually make.
 */
const SCANNED_EMITTED_EXTENSIONS = Object.freeze([
  ".js",
  ".mjs",
  ".json",
  ".map",
  ".css",
]);

function emittedScannableFiles(realStaticRoot) {
  const files = new Set();
  const visitedDirectories = new Set();

  function visit(directory) {
    let realDirectory;
    try {
      realDirectory = realpathSync(directory);
    } catch {
      throw failure("emitted client chunk directory is unreadable");
    }
    if (!isSameOrDescendant(realStaticRoot, realDirectory)) {
      throw failure("emitted client chunk escapes the static directory");
    }
    if (visitedDirectories.has(realDirectory)) return;
    visitedDirectories.add(realDirectory);

    let entries;
    try {
      entries = readdirSync(realDirectory, { withFileTypes: true });
    } catch {
      throw failure("emitted client chunk directory is unreadable");
    }
    for (const entry of entries) {
      const requestedPath = path.join(realDirectory, entry.name);
      let realPath;
      let stats;
      try {
        realPath = realpathSync(requestedPath);
        stats = statSync(realPath);
      } catch {
        throw failure("emitted client chunk path is unreadable");
      }
      if (stats.isDirectory()) {
        visit(realPath);
        continue;
      }
      if (
        !stats.isFile() ||
        !SCANNED_EMITTED_EXTENSIONS.some((extension) =>
          entry.name.endsWith(extension),
        )
      ) {
        continue;
      }
      if (!isStrictDescendant(realStaticRoot, realPath)) {
        throw failure("emitted client chunk escapes the static directory");
      }
      files.add(realPath);
    }
  }

  visit(realStaticRoot);
  return [...files].sort();
}

function assertNoServerOnlyClientContent(bodies, secretCanaries) {
  const serverOnlyMarkers = [
    ...CLIENT_BUNDLE_MARKER_CONTRACTS.promptMarkers,
    ...CLIENT_BUNDLE_MARKER_CONTRACTS.providerEndpointMarkers,
  ];
  for (const body of bodies) {
    if (serverOnlyMarkers.some((marker) => body.includes(marker))) {
      throw failure("server-only client content reached an emitted chunk");
    }
    if (
      secretCanaries.some(
        ({ value }) => value.length > 0 && body.includes(value),
      )
    ) {
      throw failure("a provider credential canary reached a client chunk");
    }
  }
}

function sourceModuleGraph(sourceText, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const references = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const namedBindings = clause?.namedBindings;
      const isTypeOnly =
        clause?.isTypeOnly === true ||
        (clause?.name === undefined &&
          namedBindings !== undefined &&
          ts.isNamedImports(namedBindings) &&
          namedBindings.elements.length > 0 &&
          namedBindings.elements.every((element) => element.isTypeOnly));
      if (
        !isTypeOnly &&
        ts.isStringLiteralLike(statement.moduleSpecifier)
      ) {
        references.push({
          kind: "static",
          specifier: statement.moduleSpecifier.text,
        });
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const isTypeOnly =
        statement.isTypeOnly ||
        (statement.exportClause !== undefined &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length > 0 &&
          statement.exportClause.elements.every(
            (element) => element.isTypeOnly,
          ));
      if (
        !isTypeOnly &&
        statement.moduleSpecifier &&
        ts.isStringLiteralLike(statement.moduleSpecifier)
      ) {
        references.push({
          kind: "static",
          specifier: statement.moduleSpecifier.text,
        });
      }
    }
  }

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [specifier] = node.arguments;
      if (specifier && ts.isStringLiteralLike(specifier)) {
        references.push({
          kind: "dynamic",
          specifier: specifier.text,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  let clientModule = false;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      break;
    }
    if (statement.expression.text === "use client") clientModule = true;
  }
  return { clientModule, references };
}

function resolveLocalSource(repositoryRoot, importerPath, specifier) {
  const unresolved =
    specifier.startsWith("@/")
      ? path.resolve(repositoryRoot, specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(importerPath), specifier)
        : undefined;
  if (!unresolved || !isSameOrDescendant(repositoryRoot, unresolved)) {
    return undefined;
  }

  const candidates = [
    unresolved,
    ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"].map(
      (extension) => `${unresolved}${extension}`,
    ),
    ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"].map(
      (extension) => path.join(unresolved, `index${extension}`),
    ),
  ];
  return candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

export function inspectPublicClientSourceDependencies({
  repositoryRoot,
  entryPaths = PUBLIC_ROUTE_ENTRY_PATHS,
  sourceOverrides = new Map(),
}) {
  const realRepositoryRoot = realpathSync(repositoryRoot);
  const pending = entryPaths.map((entryPath) =>
    ({
      requestedPath: path.isAbsolute(entryPath)
        ? entryPath
        : path.resolve(realRepositoryRoot, entryPath),
      clientReachable: false,
    }),
  );
  const visited = new Map();
  const scannedFiles = new Set();

  while (pending.length > 0) {
    const work = pending.pop();
    if (!work) continue;
    let filePath;
    try {
      filePath = realpathSync(work.requestedPath);
    } catch {
      throw failure("public route source dependency is unavailable");
    }
    if (!isSameOrDescendant(realRepositoryRoot, filePath)) continue;

    const sourceText =
      sourceOverrides.get(filePath) ??
      sourceOverrides.get(work.requestedPath) ??
      readFileSync(filePath, "utf8");
    const graph = sourceModuleGraph(sourceText, filePath);
    const clientReachable = work.clientReachable || graph.clientModule;
    const previousClientReachable = visited.get(filePath);
    if (previousClientReachable === true) continue;
    if (previousClientReachable === false && !clientReachable) continue;
    visited.set(filePath, clientReachable);
    scannedFiles.add(filePath);

    for (const reference of graph.references) {
      const isAiPackage =
        reference.specifier === CLIENT_BUNDLE_MARKER_CONTRACTS.aiPackageRoot ||
        reference.specifier.startsWith(
          `${CLIENT_BUNDLE_MARKER_CONTRACTS.aiPackageRoot}/`,
        );
      if (isAiPackage && reference.kind === "static") {
        throw failure("public route statically imports the AI package");
      }
      if (
        isAiPackage &&
        reference.kind === "dynamic" &&
        clientReachable
      ) {
        throw failure("a client module dynamically imports the AI package");
      }
      const dependency = resolveLocalSource(
        realRepositoryRoot,
        filePath,
        reference.specifier,
      );
      if (dependency) {
        pending.push({
          requestedPath: dependency,
          clientReachable,
        });
      }
    }
  }

  return Object.freeze({ scannedSourceCount: scannedFiles.size });
}

/**
 * @typedef {{
 *   route: string;
 *   htmlPath: string;
 *   forbiddenRuntimeMarkers: readonly string[];
 * }} PublicRouteContract
 */

/**
 * @param {{
 *   buildRoot: string;
 *   routes?: readonly PublicRouteContract[];
 *   budgetBytes?: number;
 *   secretCanaries?: Array<{ label: string; value: string }>;
 * }} options
 */
export function inspectPublicClientBuild({
  buildRoot,
  routes = PUBLIC_WORKBENCH_ROUTES,
  budgetBytes = PUBLIC_WORKBENCH_BUDGET_BYTES,
  secretCanaries = /** @type {Array<{ label: string; value: string }>} */ ([]),
}) {
  if (!Number.isInteger(budgetBytes) || budgetBytes < 1) {
    throw failure("budget must be a positive integer");
  }

  let realBuildRoot;
  try {
    realBuildRoot = realpathSync(buildRoot);
  } catch {
    throw failure("Next production build is unavailable");
  }

  let realStaticRoot;
  try {
    realStaticRoot = realpathSync(path.join(buildRoot, "static"));
  } catch {
    throw failure("client chunk directory is unavailable");
  }
  if (realStaticRoot !== path.join(realBuildRoot, "static")) {
    throw failure("client static directory is not canonical");
  }

  const initialFiles = new Set();
  const routeHtmlBodies = [];
  const routeReports = routes.map((routeConfig) => {
    let html;
    try {
      html = readFileSync(
        resolveRouteHtml(
          buildRoot,
          realBuildRoot,
          routeConfig.htmlPath,
          routeConfig.route,
        ),
        "utf8",
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(
        "public client bundle verification failed:",
      )) {
        throw error;
      }
      throw failure(`${routeConfig.route} emitted HTML is unavailable`);
    }
    routeHtmlBodies.push(html);
    const files = [
      ...new Set(
        initialClientScriptSources(html, routeConfig.route).map((source) =>
          resolveClientScript(
            buildRoot,
            realStaticRoot,
            source,
            routeConfig.route,
          ),
        ),
      ),
    ].sort();
    for (const filePath of files) initialFiles.add(filePath);
    const bytes = files.reduce(
      (total, filePath) => total + statSync(filePath).size,
      0,
    );
    if (bytes > budgetBytes) {
      throw failure(
        `${routeConfig.route} exceeds ${budgetBytes.toLocaleString("en-US")} bytes`,
      );
    }

    const routeBody = files
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n");
    if (
      routeConfig.forbiddenRuntimeMarkers.some((marker) =>
        routeBody.includes(marker),
      )
    ) {
      throw failure(
        `${routeConfig.route} contains a foreign domain runtime marker`,
      );
    }

    return Object.freeze({
      route: routeConfig.route,
      bytes,
      chunkCount: files.length,
    });
  });

  const resolvedInitialFiles = [...initialFiles].sort();
  const allEmittedFiles = emittedScannableFiles(realStaticRoot);
  // Emitted route HTML is swept alongside the static assets: inlined bootstrap
  // payloads are shipped to the browser exactly like a chunk is.
  assertNoServerOnlyClientContent(
    [
      ...allEmittedFiles.map((filePath) => readFileSync(filePath, "utf8")),
      ...routeHtmlBodies,
    ],
    secretCanaries,
  );

  return Object.freeze({
    budgetBytes,
    routes: Object.freeze(routeReports),
    initialChunkCount: resolvedInitialFiles.length,
    scannedChunkCount: allEmittedFiles.length,
  });
}

export function verifyPublicClientBuild({
  repoRoot = process.cwd(),
  environment = process.env,
} = {}) {
  inspectPublicClientSourceDependencies({ repositoryRoot: repoRoot });
  return inspectPublicClientBuild({
    buildRoot: path.join(repoRoot, ".next"),
    secretCanaries: [
      {
        label: "OPENAI_API_KEY",
        value: environment.OPENAI_API_KEY ?? "",
      },
      {
        label: "ANTHROPIC_API_KEY",
        value: environment.ANTHROPIC_API_KEY ?? "",
      },
    ],
  });
}

function printReport(report) {
  for (const route of report.routes) {
    process.stdout.write(
      `${route.route}: ${route.bytes.toLocaleString("en-US")} / ${report.budgetBytes.toLocaleString("en-US")} raw initial JS bytes (${route.chunkCount} chunks)\n`,
    );
  }
  process.stdout.write(
    `Client security scan: ${report.scannedChunkCount} canonical emitted client assets clean.\n`,
  );
}

const entryPath = process.argv[1];
if (
  entryPath &&
  import.meta.url === pathToFileURL(path.resolve(entryPath)).href
) {
  try {
    printReport(verifyPublicClientBuild());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "public client bundle verification failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
