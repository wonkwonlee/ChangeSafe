import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findImportedModules } from "../helpers/architecture-boundaries";

const CLIENT_SURFACE_ROOTS = ["app", "components", "features", "lib"] as const;
const CLIENT_SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;
const INSTRUMENTATION_CLIENT_PATTERN =
  /^instrumentation-client\.(?:[cm]?[jt]sx?)$/;
const PUBLIC_SCRIPT_EXTENSION = /\.(?:[cm]?js)$/;
const FORBIDDEN_TELEMETRY_PACKAGES = [
  "@vercel/speed-insights",
  "@vercel/analytics",
] as const;
const FORBIDDEN_CLIENT_TELEMETRY_SOURCE = [
  /\binjectSpeedInsights\b/,
  /\bwindow\.si\b/,
  /\/_vercel\/(?:insights|speed-insights)/,
] as const;

function filesMatching(
  directory: string,
  acceptsFile: (fileName: string) => boolean,
): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesMatching(candidate, acceptsFile);
    return acceptsFile(entry.name) ? [candidate] : [];
  });
}

function telemetryPackage(specifier: string): string | null {
  return (
    FORBIDDEN_TELEMETRY_PACKAGES.find(
      (packageName) =>
        specifier === packageName || specifier.startsWith(`${packageName}/`),
    ) ?? null
  );
}

function clientTelemetryViolations(repositoryRoot: string): readonly string[] {
  const clientSourceFiles = CLIENT_SURFACE_ROOTS.flatMap((root) => {
    const sourceRoot = path.join(repositoryRoot, root);
    return existsSync(sourceRoot)
      ? filesMatching(sourceRoot, (fileName) =>
          CLIENT_SOURCE_EXTENSION.test(fileName),
        )
      : [];
  });
  const instrumentationFiles = ["", "src"].flatMap((parent) => {
    const directory = path.join(repositoryRoot, parent);
    return existsSync(directory)
      ? readdirSync(directory, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() &&
              INSTRUMENTATION_CLIENT_PATTERN.test(entry.name),
          )
          .map((entry) => path.join(directory, entry.name))
      : [];
  });
  const publicRoot = path.join(repositoryRoot, "public");
  const publicScripts = existsSync(publicRoot)
    ? filesMatching(publicRoot, (fileName) =>
        PUBLIC_SCRIPT_EXTENSION.test(fileName),
      )
    : [];
  const sourceFiles = [
    ...new Set([
      ...clientSourceFiles,
      ...instrumentationFiles,
      ...publicScripts,
    ]),
  ];

  return sourceFiles.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const relativeFile = path
      .relative(repositoryRoot, file)
      .split(path.sep)
      .join("/");
    const importViolations = findImportedModules(file, source).flatMap(
      ({ line, specifier }) => {
        const packageName = telemetryPackage(specifier);
        return packageName
          ? [`${relativeFile}:${line} imports forbidden telemetry package "${packageName}"`]
          : [];
      },
    );
    const sourceViolations = FORBIDDEN_CLIENT_TELEMETRY_SOURCE.flatMap(
      (pattern) =>
        pattern.test(source)
          ? [`${relativeFile}: contains forbidden telemetry source "${pattern.source}"`]
          : [],
    );
    return [...importViolations, ...sourceViolations];
  });
}

describe("client telemetry privacy boundary", () => {
  it("ships no client telemetry collector or injection surface", () => {
    const packageManifest = JSON.parse(
      readFileSync(path.resolve("package.json"), "utf8"),
    ) as {
      dependencies?: Readonly<Record<string, string>>;
      devDependencies?: Readonly<Record<string, string>>;
    };
    const packageLock = JSON.parse(
      readFileSync(path.resolve("package-lock.json"), "utf8"),
    ) as {
      packages?: Readonly<
        Record<
          string,
          {
            dependencies?: Readonly<Record<string, string>>;
            devDependencies?: Readonly<Record<string, string>>;
          }
        >
      >;
    };
    const declaredTelemetryPackages = FORBIDDEN_TELEMETRY_PACKAGES.filter(
      (packageName) =>
        packageManifest.dependencies?.[packageName] !== undefined ||
        packageManifest.devDependencies?.[packageName] !== undefined ||
        packageLock.packages?.[""]?.dependencies?.[packageName] !== undefined ||
        packageLock.packages?.[""]?.devDependencies?.[packageName] !==
          undefined ||
        packageLock.packages?.[`node_modules/${packageName}`] !== undefined,
    );

    expect(declaredTelemetryPackages).toEqual([]);
    expect(clientTelemetryViolations(process.cwd())).toEqual([]);
  });

  it.each([
    "instrumentation-client.ts",
    "src/instrumentation-client.ts",
  ])("detects a forbidden import in %s", (relativePath) => {
    const fixtureRoot = mkdtempSync(
      path.join(os.tmpdir(), "changesafe-telemetry-privacy-"),
    );
    mkdirSync(path.join(fixtureRoot, "public"));
    const fixturePath = path.join(fixtureRoot, ...relativePath.split("/"));
    mkdirSync(path.dirname(fixturePath), {
      recursive: true,
    });
    writeFileSync(
      fixturePath,
      'import { SpeedInsights as start } from "@vercel/speed-insights";\nvoid start;\n',
    );

    try {
      expect(clientTelemetryViolations(fixtureRoot)).toContain(
        `${relativePath}:1 imports forbidden telemetry package "@vercel/speed-insights"`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true });
    }
  });

  it("detects a hard-coded collector in a browser-delivered public script", () => {
    const fixtureRoot = mkdtempSync(
      path.join(os.tmpdir(), "changesafe-telemetry-privacy-"),
    );
    mkdirSync(path.join(fixtureRoot, "public"));
    writeFileSync(
      path.join(fixtureRoot, "public", "collector.js"),
      'navigator.sendBeacon("/_vercel/insights/view", "{}");\n',
    );

    try {
      expect(clientTelemetryViolations(fixtureRoot)).toEqual([
        expect.stringContaining("public/collector.js:"),
      ]);
    } finally {
      rmSync(fixtureRoot, { recursive: true });
    }
  });
});
