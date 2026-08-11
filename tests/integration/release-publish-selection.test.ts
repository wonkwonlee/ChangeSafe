import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "select-unpublished.sh");

const ALL = [
  "@changesafe/core",
  "@changesafe/domain-network",
  "@changesafe/domain-terraform",
  "@changesafe/domain-kubernetes",
  "changesafe",
] as const;

const temporaryDirectories: string[] = [];
afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Run the real script with a stubbed `npm` that reports exactly `published`
 * as already on the registry at `publishedVersion`.
 *
 * The stub is a shell script on PATH rather than a mocked module, because the
 * thing under test is the script the release workflow actually executes. A
 * transcription of its logic into TypeScript would pass while the shipped file
 * was broken — which is the failure mode this test exists to prevent.
 */
function stubbedNpmDir(published: readonly string[], publishedVersion: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "changesafe-publish-"));
  temporaryDirectories.push(dir);

  const npmStub = path.join(dir, "npm");
  writeFileSync(
    npmStub,
    [
      "#!/usr/bin/env bash",
      // `npm view <name>@<version> version` is the only call the script makes.
      'if [ "$1" != "view" ]; then exit 1; fi',
      `case "$2" in`,
      ...published.map(
        (name) => `  "${name}@${publishedVersion}") echo "${publishedVersion}"; exit 0 ;;`,
      ),
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(npmStub, 0o755);
  return dir;
}

function run(dir: string, args: readonly string[]): string {
  return execFileSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });
}

describe("release publish selection", () => {
  it("publishes every package when the registry has none of them", () => {
    const dir = stubbedNpmDir([], "0.5.0");
    const stdout = run(dir, ["0.5.0", ...ALL]);
    expect(stdout.split("\n").filter(Boolean)).toEqual([...ALL]);
  });

  it("refuses when any package version already exists, published or not", () => {
    // No automated check here can tell "a resumed run of this exact release"
    // apart from "an attacker's or a mistaken hand-publish already sitting
    // under this version number" — so any existing version fails the run
    // rather than being silently treated as already done.
    const dir = stubbedNpmDir(["@changesafe/domain-kubernetes"], "0.5.0");
    expect(() => run(dir, ["0.5.0", ...ALL])).toThrow();
  });

  it("does not confuse one version with another", () => {
    // Everything is on the registry at 0.4.0 while the release is 0.5.0.
    // Treating that as already-published would ship an empty release that
    // still reported success.
    const dir = stubbedNpmDir(ALL, "0.4.0");
    const stdout = run(dir, ["0.5.0", ...ALL]);
    expect(stdout.split("\n").filter(Boolean), "0.4.0 on the registry must not satisfy a 0.5.0 release").toEqual([
      ...ALL,
    ]);
  });

  it("treats a registry it cannot reach as unpublished", () => {
    // Failing towards "publish it" is the safe direction: npm itself refuses
    // a duplicate version, whereas skipping on a lookup error would ship an
    // incomplete release that still reported success.
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-publish-"));
    temporaryDirectories.push(dir);
    const npmStub = path.join(dir, "npm");
    writeFileSync(npmStub, "#!/usr/bin/env bash\necho 'network unreachable' >&2\nexit 7\n");
    chmodSync(npmStub, 0o755);

    const stdout = run(dir, ["0.4.0", ...ALL]);
    expect(stdout.split("\n").filter(Boolean)).toEqual([...ALL]);
  });
});
