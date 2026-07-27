import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");

function topLevelJobBlocks(yaml: string): Array<{ name: string; body: string }> {
  const lines = yaml.split("\n");
  const jobsStart = lines.findIndex((line) => line === "jobs:");

  if (jobsStart === -1) {
    return [];
  }

  const jobs: Array<{ name: string; body: string }> = [];
  let current: { name: string; lines: string[] } | undefined;

  for (const line of lines.slice(jobsStart + 1)) {
    const jobHeader = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    const jobName = jobHeader?.[1];

    if (jobName) {
      if (current) {
        jobs.push({ name: current.name, body: current.lines.join("\n") });
      }
      current = { name: jobName, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    jobs.push({ name: current.name, body: current.lines.join("\n") });
  }

  return jobs;
}

describe("v0.1.0 runtime contract", () => {
  it("pins Node 22 and npm 10.9.8 in manifest and lockfile", () => {
    expect(readFileSync(path.join(root, ".nvmrc"), "utf8").trim()).toBe("22");
    expect(pkg.engines).toEqual({ node: ">=22 <23", npm: "10.9.8" });
    expect(pkg.packageManager).toBe("npm@10.9.8");
    expect(lock.packages[""].engines).toEqual(pkg.engines);
  });

  it("pins every CI job to the ordered Node 22 and npm 10.9.8 install contract", () => {
    expect(workflow).not.toContain('node: ["22", "24"]');
    expect(workflow).not.toMatch(/path:\s*node_modules/);
    expect(workflow).toContain("cache: npm");
    expect(workflow).toContain("npm@10.9.8");
    expect(workflow).toContain("npm ci");

    const jobs = topLevelJobBlocks(workflow);
    expect(jobs.length).toBeGreaterThan(0);

    for (const job of jobs) {
      const nodeVersions = [
        ...job.body.matchAll(/^\s+node-version:\s*["']?([^"'#\s]+)["']?\s*$/gm),
      ].map((match) => match[1]);
      expect(nodeVersions, `${job.name} must use only Node 22`).toEqual(["22"]);
      expect(job.body, `${job.name} must not use a matrix`).not.toMatch(/\bmatrix\b/);

      const setupNode = job.body.indexOf("uses: actions/setup-node@v4");
      const cacheNpm = job.body.indexOf("cache: npm");
      const pinNpm = job.body.indexOf("name: Pin npm");
      const pinNpmCommand = job.body.indexOf("run: npm install --global npm@10.9.8");
      const assertRuntime = job.body.indexOf("name: Assert runtime contract");
      const assertNode22 = job.body.indexOf(
        'test "$(node --version | cut -d. -f1)" = "v22"',
      );
      const assertNpmVersion = job.body.indexOf('test "$(npm --version)" = "10.9.8"');
      const immutableInstall = job.body.indexOf("- run: npm ci");

      expect(setupNode, `${job.name} must set up Node`).toBeGreaterThanOrEqual(0);
      expect(
        assertNode22,
        `${job.name} must assert Node 22, installing or not`,
      ).toBeGreaterThan(setupNode);

      /**
       * A job that installs nothing is held to a different contract, not to a
       * looser one. `action-selftest` deliberately runs with no dependencies
       * because that is what a consumer of the Action has — the committed CLI
       * bundle and a checkout — and an `npm ci` there would hide a bundle
       * that only works inside its own workspace. So it must prove the
       * absence rather than merely omit the install.
       */
      if (immutableInstall === -1) {
        expect(
          job.body,
          `${job.name} installs nothing, so it must prove node_modules is absent`,
        ).toContain("test ! -d node_modules");
        expect(
          job.body,
          `${job.name} installs nothing, so it must not need the npm pin`,
        ).not.toContain("npm@10.9.8");
        continue;
      }

      expect(cacheNpm, `${job.name} must cache npm`).toBeGreaterThan(setupNode);
      expect(pinNpm, `${job.name} must pin npm after setup`).toBeGreaterThan(cacheNpm);
      expect(
        assertNode22,
        `${job.name} must assert Node 22 after pinning npm`,
      ).toBeGreaterThan(pinNpm);
      expect(
        pinNpmCommand,
        `${job.name} must install npm 10.9.8 in its pin step`,
      ).toBeGreaterThan(pinNpm);
      expect(
        assertRuntime,
        `${job.name} must assert the runtime after pinning npm`,
      ).toBeGreaterThan(pinNpmCommand);
      expect(
        assertNode22,
        `${job.name} must assert Node 22 before install`,
      ).toBeGreaterThan(assertRuntime);
      expect(
        assertNpmVersion,
        `${job.name} must assert npm 10.9.8 before install`,
      ).toBeGreaterThan(assertNode22);
      expect(
        immutableInstall,
        `${job.name} must run npm ci after the runtime assertion`,
      ).toBeGreaterThan(assertNpmVersion);
    }
  });
});
