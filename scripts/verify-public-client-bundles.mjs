import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PUBLIC_WORKBENCH_BUDGET_BYTES = 1_310_720;

export const PUBLIC_WORKBENCH_ROUTES = Object.freeze([
  Object.freeze({
    route: "/workbench",
    htmlPath: "server/app/workbench.html",
    forbiddenRuntimeMarkers: Object.freeze([
      "DESTRUCTIVE_OP",
      "REVERSIBILITY",
      "K8S_",
    ]),
  }),
  Object.freeze({
    route: "/workbench/terraform",
    htmlPath: "server/app/workbench/terraform.html",
    forbiddenRuntimeMarkers: Object.freeze([
      "MGMT_REACHABILITY",
      "K8S_",
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
]);

const SERVER_ONLY_CLIENT_MARKERS = Object.freeze([
  "@changesafe/ai",
  "packages/ai",
  "untrusted_incident_data",
  "api.openai.com",
  "api.anthropic.com",
  "11434",
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
  return [...new Set(sources)].sort();
}

function resolveClientScript(buildRoot, realBuildRoot, source, route) {
  const relativePath = source.slice("/_next/".length);
  const requestedPath = path.resolve(buildRoot, relativePath);
  let realPath;
  try {
    realPath = realpathSync(requestedPath);
  } catch {
    throw failure(`${route} references a missing client script`);
  }
  if (!isStrictDescendant(realBuildRoot, realPath)) {
    throw failure(`${route} contains an invalid client script path`);
  }
  return realPath;
}

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return javascriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
    })
    .sort();
}

function assertNoServerOnlyClientContent(files, secretCanaries) {
  for (const filePath of files) {
    const body = readFileSync(filePath, "utf8");
    if (SERVER_ONLY_CLIENT_MARKERS.some((marker) => body.includes(marker))) {
      throw failure("server-only AI content reached a client chunk");
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

  const routeReports = routes.map((routeConfig) => {
    let html;
    try {
      html = readFileSync(
        path.join(buildRoot, routeConfig.htmlPath),
        "utf8",
      );
    } catch {
      throw failure(`${routeConfig.route} emitted HTML is unavailable`);
    }
    const files = initialClientScriptSources(html, routeConfig.route).map(
      (source) =>
        resolveClientScript(
          buildRoot,
          realBuildRoot,
          source,
          routeConfig.route,
        ),
    );
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

  let allClientFiles;
  try {
    allClientFiles = javascriptFiles(path.join(buildRoot, "static"));
  } catch {
    throw failure("client chunk directory is unavailable");
  }
  assertNoServerOnlyClientContent(allClientFiles, secretCanaries);

  return Object.freeze({
    budgetBytes,
    routes: Object.freeze(routeReports),
    scannedChunkCount: allClientFiles.length,
  });
}

export function verifyPublicClientBuild({
  repoRoot = process.cwd(),
  environment = process.env,
} = {}) {
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
    `Client security scan: ${report.scannedChunkCount} emitted JavaScript chunks clean.\n`,
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
