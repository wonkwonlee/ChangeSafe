import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLIENT_BUNDLE_MARKER_CONTRACTS,
  PUBLIC_WORKBENCH_BUDGET_BYTES,
  PUBLIC_WORKBENCH_ROUTES,
  inspectPublicClientSourceDependencies,
  inspectPublicClientBuild,
} from "../../scripts/verify-public-client-bundles.mjs";

const temporaryDirectories: string[] = [];

function temporaryBuild(): string {
  const container = mkdtempSync(path.join(tmpdir(), "changesafe-client-build-"));
  const buildRoot = path.join(container, ".next");
  mkdirSync(buildRoot);
  temporaryDirectories.push(container);
  return buildRoot;
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
      "/",
      "/workbench/terraform",
      "/workbench/kubernetes",
    ]);
    expect(PUBLIC_WORKBENCH_ROUTES[0]?.htmlPath).toBe("server/app/index.html");
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
    expect(report.initialChunkCount).toBe(2);
  });

  it("deduplicates different emitted aliases that resolve to the same client chunk", () => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/canonical.js", "canonical");
    symlinkSync(
      "canonical.js",
      path.join(buildRoot, "static/chunks/alias.js"),
    );
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/canonical.js",
      "/_next/static/chunks/alias.js",
    ]);

    const report = inspectPublicClientBuild({
      buildRoot,
      budgetBytes: 10_000,
      routes: [
        {
          route: "/workbench",
          htmlPath: "server/app/workbench.html",
          forbiddenRuntimeMarkers: [],
        },
      ],
    });

    expect(report.routes[0]).toEqual({
      route: "/workbench",
      bytes: Buffer.byteLength("canonical"),
      chunkCount: 1,
    });
    expect(report.initialChunkCount).toBe(1);
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

  it.each([
    ["OPENAI_API_KEY", "sk-test-never-print-openai"],
    ["ANTHROPIC_API_KEY", "sk-ant-test-never-print-anthropic"],
  ])("rejects the %s canary without echoing its value", (label, secret) => {
    const buildRoot = temporaryBuild();
    writeBuildFile(
      buildRoot,
      "static/chunks/server-only.js",
      `const value="${secret}"`,
    );
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
        secretCanaries: [{ label, value: secret }],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("public client bundle verification failed");
    expect(message).not.toContain(secret);
  });

  it.each([
    ...CLIENT_BUNDLE_MARKER_CONTRACTS.promptMarkers.map((marker) => [
      "prompt",
      marker,
    ] as const),
    ...CLIENT_BUNDLE_MARKER_CONTRACTS.providerEndpointMarkers.map((marker) => [
      "provider endpoint",
      marker,
    ] as const),
  ])("rejects the precise %s marker %s", (_kind, marker) => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/server-only.js", marker);
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/server-only.js",
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
      "public client bundle verification failed: server-only client content reached an emitted chunk",
    );
  });

  it.each([
    ...CLIENT_BUNDLE_MARKER_CONTRACTS.promptMarkers.map((marker) => [
      "prompt",
      marker,
    ] as const),
    ...CLIENT_BUNDLE_MARKER_CONTRACTS.providerEndpointMarkers.map((marker) => [
      "provider endpoint",
      marker,
    ] as const),
  ])("rejects a %s marker from an unreferenced emitted chunk", (_kind, marker) => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/initial.js", "safe initial");
    writeBuildFile(buildRoot, "static/chunks/lazy.js", marker);
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/initial.js",
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
      }),
    ).toThrow(
      "public client bundle verification failed: server-only client content reached an emitted chunk",
    );
  });

  it("rejects a credential canary from an unreferenced emitted chunk without echoing it", () => {
    const secret = "sk-ant-lazy-chunk-must-not-print";
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/initial.js", "safe initial");
    writeBuildFile(buildRoot, "static/chunks/lazy.js", secret);
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/initial.js",
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
        secretCanaries: [{ label: "ANTHROPIC_API_KEY", value: secret }],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe(
      "public client bundle verification failed: a provider credential canary reached a client chunk",
    );
    expect(message).not.toContain(secret);
  });

  it.each(
    PUBLIC_WORKBENCH_ROUTES.flatMap((routeConfig) =>
      routeConfig.forbiddenRuntimeMarkers.map((marker) => [
        routeConfig,
        marker,
      ] as const),
    ),
  )("rejects %s foreign policy marker %s", (routeConfig, marker) => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/route.js", marker);
    writeRoute(buildRoot, routeConfig.htmlPath, [
      "/_next/static/chunks/route.js",
    ]);

    expect(() =>
      inspectPublicClientBuild({
        buildRoot,
        budgetBytes: 10_000,
        routes: [routeConfig],
      }),
    ).toThrow(
      `public client bundle verification failed: ${routeConfig.route} contains a foreign domain runtime marker`,
    );
  });

  it.each([
    [PUBLIC_WORKBENCH_ROUTES[0], "MGMT_REACHABILITY"],
    [PUBLIC_WORKBENCH_ROUTES[1], "DESTRUCTIVE_OP"],
    [PUBLIC_WORKBENCH_ROUTES[2], "K8S_PRIVILEGE_ESCALATION"],
    [PUBLIC_WORKBENCH_ROUTES[2], "the benign metric value is 11434"],
  ] as const)("allows %s own or benign marker %s", (routeConfig, marker) => {
    if (!routeConfig) throw new Error("Expected a public route contract");
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/route.js", marker);
    writeRoute(buildRoot, routeConfig.htmlPath, [
      "/_next/static/chunks/route.js",
    ]);

    expect(() =>
      inspectPublicClientBuild({
        buildRoot,
        budgetBytes: 10_000,
        routes: [routeConfig],
      }),
    ).not.toThrow();
  });

  it.each([
    "/_next/static/../server/app.js",
    "/_next/static/chunks/../chunks/app.js",
  ])("rejects path-traversing or dot-segment script source %s", (source) => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/placeholder.js", "placeholder");
    writeRoute(buildRoot, "server/app/workbench.html", [source]);

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

  it("rejects a static directory symlinked to server output", () => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "server/app/workbench.html", [
      '<script src="/_next/static/chunks/app.js"></script>',
    ].join(""));
    writeBuildFile(buildRoot, "server/chunks/app.js", "server output");
    symlinkSync("server", path.join(buildRoot, "static"), "dir");

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
      }),
    ).toThrow(
      "public client bundle verification failed: client static directory is not canonical",
    );
  });

  it("rejects an unreferenced emitted JavaScript symlink that escapes the static root", () => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/initial.js", "safe initial");
    writeBuildFile(buildRoot, "../outside.js", "outside static");
    symlinkSync(
      path.join(buildRoot, "../outside.js"),
      path.join(buildRoot, "static/chunks/escaped.js"),
    );
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/initial.js",
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
      }),
    ).toThrow(
      "public client bundle verification failed: emitted client chunk escapes the static directory",
    );
  });

  it("rejects an emitted JavaScript directory symlink that escapes the static root", () => {
    const buildRoot = temporaryBuild();
    const providerMarker =
      CLIENT_BUNDLE_MARKER_CONTRACTS.providerEndpointMarkers[0];
    if (!providerMarker) throw new Error("Expected a provider endpoint marker");
    writeBuildFile(buildRoot, "static/chunks/initial.js", "safe initial");
    writeBuildFile(
      buildRoot,
      "../outside-chunks/lazy.js",
      providerMarker,
    );
    symlinkSync(
      path.join(buildRoot, "../outside-chunks"),
      path.join(buildRoot, "static/lazy"),
      "dir",
    );
    writeRoute(buildRoot, "server/app/workbench.html", [
      "/_next/static/chunks/initial.js",
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
      }),
    ).toThrow(
      "public client bundle verification failed: emitted client chunk escapes the static directory",
    );
  });

  it("rejects a route HTML path that traverses outside the build root", () => {
    const buildRoot = temporaryBuild();
    writeBuildFile(buildRoot, "static/chunks/app.js", "client");
    writeFileSync(
      path.join(buildRoot, "../outside.html"),
      '<script src="/_next/static/chunks/app.js"></script>',
    );

    expect(() =>
      inspectPublicClientBuild({
        buildRoot,
        budgetBytes: 10_000,
        routes: [
          {
            route: "/workbench",
            htmlPath: "../outside.html",
            forbiddenRuntimeMarkers: [],
          },
        ],
      }),
    ).toThrow(
      "public client bundle verification failed: /workbench contains an invalid emitted HTML path",
    );
  });

  it.each([
    "@changesafe/ai",
    "@changesafe/ai/providers/openai",
  ])("rejects a public route static dependency on %s", (specifier) => {
    const entryPath = path.resolve("app/page.tsx");
    const original = readFileSync(entryPath, "utf8");
    expect(() =>
      inspectPublicClientSourceDependencies({
        repositoryRoot: process.cwd(),
        sourceOverrides: new Map([
          [entryPath, `${original}\nimport "${specifier}";\n`],
        ]),
      }),
    ).toThrow(
      "public client bundle verification failed: public route statically imports the AI package",
    );
  });

  it("allows type-only and dynamic AI package references outside the static graph", () => {
    const entryPath = path.resolve("app/page.tsx");
    const original = readFileSync(entryPath, "utf8");
    expect(() =>
      inspectPublicClientSourceDependencies({
        repositoryRoot: process.cwd(),
        sourceOverrides: new Map([
          [
            entryPath,
            `${original}
import type { AnalysisProvider } from "@changesafe/ai";
export type { AnalysisProvider as Provider } from "@changesafe/ai";
export { type AnalysisProvider as ProviderAlias } from "@changesafe/ai";
void import("@changesafe/ai");
`,
          ],
        ]),
      }),
    ).not.toThrow();
  });

  it.each([
    "@changesafe/ai",
    "@changesafe/ai/providers/anthropic",
  ])("rejects a client component dynamic dependency on %s", (specifier) => {
    const componentPath = path.resolve(
      "components/ReviewWorkbenchShell.tsx",
    );
    const original = readFileSync(componentPath, "utf8");

    expect(() =>
      inspectPublicClientSourceDependencies({
        repositoryRoot: process.cwd(),
        sourceOverrides: new Map([
          [componentPath, `${original}\nvoid import("${specifier}");\n`],
        ]),
      }),
    ).toThrow(
      "public client bundle verification failed: a client module dynamically imports the AI package",
    );
  });

  it("rejects a dynamic AI dependency in a local module inherited by a client graph", () => {
    const dependencyPath = path.resolve("components/BoundedEvidence.tsx");
    const original = readFileSync(dependencyPath, "utf8");

    expect(() =>
      inspectPublicClientSourceDependencies({
        repositoryRoot: process.cwd(),
        sourceOverrides: new Map([
          [
            dependencyPath,
            `${original}\nvoid import("@changesafe/ai/providers/openai");\n`,
          ],
        ]),
      }),
    ).toThrow(
      "public client bundle verification failed: a client module dynamically imports the AI package",
    );
  });

  it("rejects a direct dynamic AI dependency from the self-hosted client workbench", () => {
    const componentPath = path.resolve(
      "components/SelfHostedReviewWorkbench.tsx",
    );
    const original = readFileSync(componentPath, "utf8");

    expect(() =>
      inspectPublicClientSourceDependencies({
        repositoryRoot: process.cwd(),
        sourceOverrides: new Map([
          [componentPath, `${original}\nvoid import("@changesafe/ai");\n`],
        ]),
      }),
    ).toThrow(
      "public client bundle verification failed: a client module dynamically imports the AI package",
    );
  });

  it("rejects a provider subpath dynamically imported below the self-hosted client boundary", () => {
    const dependencyPath = path.resolve(
      "components/SelfHostedReviewDetail.tsx",
    );
    const original = readFileSync(dependencyPath, "utf8");

    expect(() =>
      inspectPublicClientSourceDependencies({
        repositoryRoot: process.cwd(),
        sourceOverrides: new Map([
          [
            dependencyPath,
            `${original}\nvoid import("@changesafe/ai/providers/anthropic");\n`,
          ],
        ]),
      }),
    ).toThrow(
      "public client bundle verification failed: a client module dynamically imports the AI package",
    );
  });
});
