import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");

describe("v0.1.0 runtime contract", () => {
  it("pins Node 22 and npm 10.9.8 in manifest and lockfile", () => {
    expect(readFileSync(path.join(root, ".nvmrc"), "utf8").trim()).toBe("22");
    expect(pkg.engines).toEqual({ node: ">=22 <23", npm: "10.9.8" });
    expect(pkg.packageManager).toBe("npm@10.9.8");
    expect(lock.packages[""].engines).toEqual(pkg.engines);
  });

  it("uses one Node major and never caches node_modules", () => {
    expect(workflow).not.toContain('node: ["22", "24"]');
    expect(workflow).not.toMatch(/path:\s*node_modules/);
    expect(workflow).toContain("cache: npm");
    expect(workflow).toContain("npm@10.9.8");
    expect(workflow).toContain("npm ci");
  });
});
