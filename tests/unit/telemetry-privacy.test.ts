import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_SURFACE_ROOTS = ["app", "components", "features", "lib"] as const;
const CLIENT_SOURCE_EXTENSION = /\.(?:ts|tsx|js|jsx)$/;
const FORBIDDEN_CLIENT_TELEMETRY = [
  /@vercel\/speed-insights/,
  /@vercel\/analytics/,
  /\binjectSpeedInsights\b/,
  /\bwindow\.si\b/,
  /\/_vercel\/(?:insights|speed-insights)/,
] as const;

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(candidate);
    return CLIENT_SOURCE_EXTENSION.test(entry.name) ? [candidate] : [];
  });
}

describe("client telemetry privacy boundary", () => {
  it("ships no client telemetry collector or injection surface", () => {
    const violations = CLIENT_SURFACE_ROOTS.flatMap((root) =>
      sourceFiles(root).flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return FORBIDDEN_CLIENT_TELEMETRY.flatMap((pattern) =>
          pattern.test(source) ? [`${file}: ${pattern.source}`] : [],
        );
      }),
    );

    expect(violations).toEqual([]);
  });
});
