import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "select-unpublished.sh");
const EXPECTED_GIT_HEAD = "abcdef0123456789abcdef0123456789abcdef01";

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
 * A stub `npm` on PATH that answers `npm view <name>@<version> version` and
 * `npm view <name>@<version> gitHead` for exactly the registry state given.
 *
 * A shell script rather than a mocked module, because the thing under test is
 * the script the release workflow actually executes. A transcription of its
 * logic into TypeScript would pass while the shipped file was broken — which
 * is the failure mode this test exists to prevent.
 */
function writeNpmStub(
  dir: string,
  registry: Record<string, { version: string; gitHead?: string }>,
): void {
  const npmStub = path.join(dir, "npm");
  const lines = [
    "#!/usr/bin/env bash",
    'if [ "$1" != "view" ]; then exit 1; fi',
    'case "$2:$3" in',
    ...Object.entries(registry).flatMap(([nameAtVersion, entry]) => [
      `  "${nameAtVersion}:version") echo "${entry.version}"; exit 0 ;;`,
      // A published version with no recorded gitHead prints nothing but still
      // exits 0 — exactly what `npm view` does for a field the manifest
      // never set.
      `  "${nameAtVersion}:gitHead") echo "${entry.gitHead ?? ""}"; exit 0 ;;`,
    ]),
    "  *) exit 1 ;;",
    "esac",
    "",
  ];
  writeFileSync(npmStub, lines.join("\n"));
  chmodSync(npmStub, 0o755);
}

function runScript(args: readonly string[], dir: string): string {
  return execFileSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });
}

/**
 * Every already-published package in `published` is recorded as coming from
 * `EXPECTED_GIT_HEAD` unless `publishedGitHead` says otherwise — the common
 * case of a resumed run of *this* release.
 */
function selectUnpublished(
  version: string,
  published: readonly string[],
  options: { publishedVersion?: string; publishedGitHead?: string } = {},
): string[] {
  const { publishedVersion = version, publishedGitHead = EXPECTED_GIT_HEAD } = options;
  const dir = mkdtempSync(path.join(tmpdir(), "changesafe-publish-"));
  temporaryDirectories.push(dir);
  writeNpmStub(
    dir,
    Object.fromEntries(
      published.map((name) => [
        `${name}@${publishedVersion}`,
        { version: publishedVersion, gitHead: publishedGitHead },
      ]),
    ),
  );
  const stdout = runScript([version, EXPECTED_GIT_HEAD, ...ALL], dir);
  return stdout.split("\n").filter((line) => line.length > 0);
}

describe("resumable publish selection", () => {
  it("publishes every package when the registry has none of them", () => {
    expect(selectUnpublished("0.5.0", [])).toEqual([...ALL]);
  });

  it("publishes only what is missing after a partial failure", () => {
    // The v0.4.0 incident exactly: core, network, and terraform reached the
    // registry, then the run died before Kubernetes and the CLI. All three
    // came from this same release's commit, so they are trusted as-is.
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

  it("selects nothing when every package is already published from this commit", () => {
    // Must be empty rather than a retry: npm versions are immutable, so
    // republishing one is an error, not a no-op.
    expect(selectUnpublished("0.4.0", ALL)).toEqual([]);
  });

  it("does not confuse one version with another", () => {
    // Everything is on the registry at 0.4.0 while the release is 0.5.0.
    // Treating those as satisfied would ship an empty release that reported
    // success.
    const selected = selectUnpublished("0.5.0", ALL, { publishedVersion: "0.4.0" });
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

    const stdout = runScript(["0.4.0", EXPECTED_GIT_HEAD, ...ALL], dir);
    expect(stdout.split("\n").filter(Boolean)).toEqual([...ALL]);
  });

  it("refuses a version already published from a different commit", () => {
    // A hand-published version, a version published from the wrong commit,
    // or a version pushed by a compromised maintainer account before this
    // workflow ran — none of those are evidence that *this* release reached
    // the registry, so the script must not silently treat the package as done.
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-publish-"));
    temporaryDirectories.push(dir);
    writeNpmStub(dir, {
      "changesafe@0.5.0": { version: "0.5.0", gitHead: "0000000000000000000000000000000000000f" },
    });

    expect(() => runScript(["0.5.0", EXPECTED_GIT_HEAD, "changesafe"], dir)).toThrow();
  });

  it("refuses a version published with no recorded commit at all", () => {
    // A tarball published outside git (or before npm tracked gitHead) has
    // nothing to compare against — absence of proof is not proof of safety.
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-publish-"));
    temporaryDirectories.push(dir);
    writeNpmStub(dir, { "changesafe@0.5.0": { version: "0.5.0" } });

    expect(() => runScript(["0.5.0", EXPECTED_GIT_HEAD, "changesafe"], dir)).toThrow();
  });
});
