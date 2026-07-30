import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PUBLIC_WORKBENCH_BUDGET_BYTES,
  PUBLIC_WORKBENCH_ROUTES,
  inspectPublicClientBuild,
} from "../../scripts/verify-public-client-bundles.mjs";

const temporaryDirectories: string[] = [];

function temporaryBuild(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "changesafe-client-build-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeBuildFile(buildRoot: string, relativePath: string, body: string): void {
  const filePath = path.join(buildRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body);
}

function writeRoute(
  buildRoot: string,
  htmlPath: string,
  chunkSources: readonly string[],
): void {
  writeBuildFile(
    buildRoot,
    htmlPath,
    chunkSources.map((source) => `<script src="${source}"></script>`).join(""),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("public client bundle verifier", () => {
  it("covers all public workbench routes and is wired into the post-build CI gate", () => {
    expect(PUBLIC_WORKBENCH_ROUTES.map(({ route }) => route)).toEqual([
      "/workbench",
      "/workbench/terraform",
      "/workbench/kubernetes",
    ]);
    for (const route of PUBLIC_WORKBENCH_ROUTES) {
      expect(route.forbiddenRuntimeMarkers.length).toBeGreaterThan(0);
    }

    const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
    expect(packageManifest.scripts["verify:client-bundles"]).toBe(
      "node scripts/verify-public-client-bundles.mjs",
    );
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const build = workflow.indexOf(
      "- run: npm run build",
      workflow.indexOf("no-secret-leak:"),
    );
    const verify = workflow.indexOf("run: npm run verify:client-bundles", build);
    expect(build).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(build);
  });

  it("measures deduplicated initial route chunks against a fixed raw-byte budget", () => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/shared-a1.js", "shared");
    writeBuildFile(buildRoot, "static/chunks/network-b2.js", "network");
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/shared-a1.js",
      "/_next/static/chunks/network-b2.js",
      "/_next/static/chunks/shared-a1.js",
    ]);

    const report = inspectPublicClientBuild({
      buildRoot,
      budgetBytes: PUBLIC_WORKBENCH_BUDGET_BYTES,
      routes: [
        {
          route: "/workbench",
          htmlPath: "server/app/workbench.html",
          forbiddenRuntimeMarkers: ["DESTRUCTIVE_OP"],
        },
      ],
      secretCanaries: [],
    });

    expect(PUBLIC_WORKBENCH_BUDGET_BYTES).toBe(1_310_720);
    expect(report.routes).toEqual([
      {
        route: "/workbench",
        bytes: Buffer.byteLength("sharednetwork"),
        chunkCount: 2,
      },
    ]);
  });

  it("fails closed when a route exceeds its initial-JavaScript budget", () => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/oversized.js", "123456");
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/oversized.js",
    ]);

    expect(() =>
      inspectPublicClientBuild({
        buildRoot,
        budgetBytes: 5,
        routes: [
          {
            route: "/workbench",
            htmlPath: "server/app/workbench.html",
            forbiddenRuntimeMarkers: [],
          },
        ],
        secretCanaries: [],
      }),
    ).toThrow(
      "public client bundle verification failed: /workbench exceeds 5 bytes",
    );
  });

  it("rejects server-only AI markers and secret canaries without echoing secret values", () => {
    const secret = "sk-test-never-print-this-value";

    for (const body of [
      'fetch("https://api.openai.com")',
      `const value="${secret}"`,
    ]) {
      const buildRoot = temporaryBuild();
      writeBuildFile(buildRoot, "static/chunks/server-only.js", body);
      writeRoute(buildRoot, "server/app/workbench.html", [
        "/_next/static/chunks/server-only.js",
      ]);

      let message = "";
      try {
        inspectPublicClientBuild({
          buildRoot,
          budgetBytes: 10_000,
          routes: [
            {
              route: "/workbench",
              htmlPath: "server/app/workbench.html",
              forbiddenRuntimeMarkers: [],
            },
          ],
          secretCanaries: [{ label: "OPENAI_API_KEY", value: secret }],
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("public client bundle verification failed");
      expect(message).not.toContain(secret);
    }
  });

  it("rejects a foreign domain runtime marker in a route's initial chunks", () => {
    const buildRoot = temporaryBuild();
    writeBuildFile(
      buildRoot,
      "static/chunks/network.js",
      'const policyId = "DESTRUCTIVE_OP";',
    );
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/network.js",
    ]);

    expect(() =>
      inspectPublicClientBuild({
        buildRoot,
        budgetBytes: 10_000,
        routes: [
          {
            route: "/workbench",
            htmlPath: "server/app/workbench.html",
            forbiddenRuntimeMarkers: ["DESTRUCTIVE_OP"],
          },
        ],
        secretCanaries: [],
      }),
    ).toThrow(
      "public client bundle verification failed: /workbench contains a foreign domain runtime marker",
    );
  });

  it("rejects path-traversing Next script sources", () => {
    const buildRoot = temporaryBuild();
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/../server/app.js",
    ]);

    expect(() =>
      inspectPublicClientBuild({
        buildRoot,
        budgetBytes: 10_000,
        routes: [
          {
            route: "/workbench",
            htmlPath: "server/app/workbench.html",
            forbiddenRuntimeMarkers: [],
          },
        ],
        secretCanaries: [],
      }),
    ).toThrow(
      "public client bundle verification failed: /workbench contains an invalid client script path",
    );
  });
});
