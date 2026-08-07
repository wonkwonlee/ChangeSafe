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
 * as already on the registry.
 *
 * The stub is a shell script on PATH rather than a mocked module, because the
 * thing under test is the script the release workflow actually executes. A
 * transcription of its logic into TypeScript would pass while the shipped file
 * was broken — which is the failure mode this test exists to prevent.
 */
function selectUnpublished(
  version: string,
  published: readonly string[],
  publishedVersion: string = version,
): string[] {
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

  const stdout = execFileSync("bash", [SCRIPT, version, ...ALL], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });
  return stdout.split("\n").filter((line) => line.length > 0);
}

describe("resumable publish selection", () => {
  it("publishes every package when the registry has none of them", () => {
    expect(selectUnpublished("0.5.0", [])).toEqual([...ALL]);
  });

  it("publishes only what is missing after a partial failure", () => {
    // The v0.4.0 incident exactly: core, network, and terraform reached the
    // registry, then the run died before Kubernetes and the CLI.
    const landed = [
      "@changesafe/core",
      "@changesafe/domain-network",
      "@changesafe/domain-terraform",
    ];

    expect(selectUnpublished("0.4.0", landed)).toEqual([
      "@changesafe/domain-kubernetes",
      "changesafe",
    ]);
  });

  it("selects nothing when every package is already published", () => {
    // Must be empty rather than a retry: npm versions are immutable, so
    // republishing one is an error, not a no-op.
    expect(selectUnpublished("0.4.0", ALL)).toEqual([]);
  });

  it("does not confuse one version with another", () => {
    // Everything is on the registry at 0.4.0 while the release is 0.5.0.
    // Treating those as satisfied would ship an empty release that reported
    // success.
    const selected = selectUnpublished("0.5.0", ALL, "0.4.0");
    expect(selected, "0.4.0 on the registry must not satisfy a 0.5.0 release").toEqual([...ALL]);
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

    const stdout = execFileSync("bash", [SCRIPT, "0.4.0", ...ALL], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    });
    expect(stdout.split("\n").filter(Boolean)).toEqual([...ALL]);
  });
});
