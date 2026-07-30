import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
/**
 * Every workflow, not only CI: the publish workflow builds the artifact that
 * reaches the registry, so it is the last place a drifting runtime should be
 * allowed to go unnoticed.
 */
const workflowDir = path.join(root, ".github/workflows");
const workflowFiles = readdirSync(workflowDir)
  .filter((name) => name.endsWith(".yml"))
  .sort();
const workflows = workflowFiles.map((name) => ({
  name,
  body: readFileSync(path.join(workflowDir, name), "utf8"),
}));
const workflow = workflows.map((entry) => entry.body).join("\n");

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
  it("keeps every checked-in Action self-test input available without an install", () => {
    const ci = workflows.find((entry) => entry.name === "ci.yml");
    expect(ci).toBeDefined();
    const actionSelfTest = topLevelJobBlocks(ci?.body ?? "").find(
      (job) => job.name === "action-selftest",
    );
    expect(actionSelfTest).toBeDefined();
    if (!actionSelfTest) throw new Error("Expected the action-selftest CI job");

    const referencedPaths = [
      ...actionSelfTest.body.matchAll(
        /(?:^|\s)(?:node|--input|--context)\s+((?:packages|scripts)\/[^\s\\]+)/g,
      ),
    ].flatMap((match) => {
      const referencedPath = match[1];
      return referencedPath ? [referencedPath] : [];
    });

    expect(referencedPaths.length).toBeGreaterThan(0);
    for (const referencedPath of referencedPaths) {
      expect(existsSync(path.join(root, referencedPath)), referencedPath).toBe(true);
    }
  });

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

    expect(workflowFiles).toContain("ci.yml");
    expect(workflowFiles).toContain("publish.yml");

    const jobs = workflows.flatMap((entry) =>
      topLevelJobBlocks(entry.body).map((job) => ({
        name: `${entry.name}:${job.name}`,
        body: job.body,
      })),
    );
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

      /**
       * Caching is required everywhere except a release build, where npm's
       * own guidance is the opposite: what reaches the registry should come
       * from a clean resolve rather than from whatever a previous run left
       * behind. A job may therefore opt out, but only by saying so — silence
       * still fails.
       */
      const noCache = job.body.indexOf("package-manager-cache: false");
      if (noCache === -1) {
        expect(cacheNpm, `${job.name} must cache npm`).toBeGreaterThan(setupNode);
      } else {
        expect(
          cacheNpm,
          `${job.name} disables the package-manager cache, so it must not also enable it`,
        ).toBe(-1);
        expect(noCache, `${job.name} must disable the cache in its setup step`).toBeGreaterThan(
          setupNode,
        );
      }
      expect(pinNpm, `${job.name} must pin npm after setup`).toBeGreaterThan(setupNode);
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

      /**
       * The one sanctioned departure from the pinned npm, and it has to stay
       * sanctioned rather than become habit.
       *
       * Trusted publishing needs npm 11.5.1 or later, which the pinned 10.9.8
       * cannot do. Loosening the pin for the whole job would mean the gate no
       * longer ran on the runtime this repository claims to support, so the
       * upgrade happens after every check and applies only to the publish. If
       * a job upgrades npm, it must therefore do so *after* installing and
       * testing on the pin — never before.
       */
      const upgradeNpm = job.body.indexOf("npm install --global npm@11.5.1");
      if (upgradeNpm !== -1) {
        const test = job.body.indexOf("- run: npm test");
        expect(test, `${job.name} must still run the suite`).toBeGreaterThan(immutableInstall);
        expect(
          upgradeNpm,
          `${job.name} must upgrade npm only after the gate has run on the pinned version`,
        ).toBeGreaterThan(test);
        expect(
          job.body,
          `${job.name} must assert the upgraded npm version it relies on`,
        ).toContain('test "$(npm --version)" = "11.5.1"');
      }
    }
  });

  /**
   * Publishing authenticates over OIDC, not with a stored credential. A token
   * reappearing in this workflow would be a silent step back to a long-lived
   * secret — and it would still *work*, which is exactly why a test has to
   * say so rather than a comment.
   */
  it("publishes over OIDC and stores no npm credential", () => {
    const publish = workflows.find((entry) => entry.name === "publish.yml");
    expect(publish, "publish.yml must exist").toBeDefined();
    const body = publish?.body ?? "";

    /**
     * Comments in this workflow explain why a token, `--provenance`, and
     * `workflow_dispatch` are absent — so a naive substring search over the
     * file would be failed by the very sentences documenting the rule. The
     * assertions therefore read the executable YAML only.
     */
    const code = body
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");

    expect(code, "publishing must not read an npm token").not.toContain("NODE_AUTH_TOKEN");
    expect(code, "publishing must not read an npm token").not.toContain("NPM_TOKEN");
    expect(code, "OIDC needs id-token: write").toContain("id-token: write");

    const publishCommands = code.split("\n").filter((line) => line.includes("npm publish"));
    expect(publishCommands.length, "publish.yml must publish something").toBeGreaterThan(0);
    for (const command of publishCommands) {
      expect(command, "provenance is attached automatically").not.toContain("--provenance");
    }
    // npm's docs: with workflow_dispatch or workflow_call, OIDC validation
    // checks the calling workflow's name, which fails as a mismatch.
    expect(code, "only a published release may publish").not.toContain("workflow_dispatch");
    expect(code, "only a published release may publish").not.toContain("workflow_call");
    expect(code, "release builds must not reuse a package cache").toContain(
      "package-manager-cache: false",
    );
  });
});
