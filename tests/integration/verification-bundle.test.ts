import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  PROTECTED_FILES,
  APP_VERSION,
  RECEIPT_ID,
  SOURCE_ID,
  canonicalJson,
  runCommand,
  sha256Text,
  verifyBundle,
} from "../../scripts/lib/v0.1.0-release.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(ROOT, "packages/cli/dist/changesafe.js");
const SCENARIO = path.join(ROOT, "scenarios/network/scenario-a-failover");
const CREATED_AT = "2026-07-26T12:00:00.000Z";
/**
 * Proving that cleanup *fails* means making it fail, and the portable way is
 * to remove write permission from the parent directory. Root is exempt from
 * that check, so under uid 0 — how many CI containers and devcontainers run —
 * the removal succeeds and the build fails somewhere else entirely, failing
 * the assertion for a reason that has nothing to do with the code. Skipped
 * rather than weakened: the behavior stays covered wherever permissions mean
 * something.
 */
const itWherePermissionsApply = it.skipIf(process.getuid?.() === 0);
const temporaryDirectories: string[] = [];
let cliBuild: Promise<void> | undefined;

interface TemporaryBundle {
  directory: string;
  privateKey: string;
}

interface TemporaryKey {
  privatePath: string;
  publicPath: string;
}

interface BuilderRepository {
  root: string;
  script: string;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "changesafe-v0.1.0-"));
  temporaryDirectories.push(directory);
  return directory;
}

function buildCliOnce(): Promise<void> {
  cliBuild ??= Promise.resolve().then(() => {
    execFileSync("npm", ["run", "build:cli", "--silent"], {
      cwd: ROOT,
      stdio: "pipe",
    });
  });
  return cliBuild;
}

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function generateTemporaryKey(): TemporaryKey {
  const root = temporaryDirectory();
  const keyBase = path.join(root, "demo");
  const keygen = JSON.parse(
    runCli(["keygen", "--out", keyBase, "--format", "json"]),
  ) as {
    privateKey: string;
    publicKey: string;
  };
  return {
    privatePath: path.resolve(keygen.privateKey),
    publicPath: path.resolve(keygen.publicKey),
  };
}

function initializeGitRepository(root: string): void {
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.name", "ChangeSafe Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@changesafe.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "builder fixture"], { cwd: root });
}

function createBuilderRepository(options?: {
  fixture?: (fixture: Record<string, unknown>) => void;
  cliHook?: string;
  atomicRenameHook?: string;
  platform?: "darwin" | "linux" | "win32";
}): BuilderRepository {
  const root = temporaryDirectory();
  const script = path.join(root, "scripts", "build-v0.1.0-bundle.mjs");
  const releaseLibrary = path.join(root, "scripts", "lib", "v0.1.0-release.mjs");
  const cli = path.join(root, "packages", "cli", "dist", "changesafe.js");
  const scenario = path.join(root, "scenarios", "network", "scenario-a-failover");

  mkdirSync(path.dirname(releaseLibrary), { recursive: true });
  mkdirSync(path.dirname(cli), { recursive: true });
  mkdirSync(scenario, { recursive: true });
  copyFileSync(path.join(ROOT, "scripts", "build-v0.1.0-bundle.mjs"), script);
  copyFileSync(path.join(ROOT, "scripts", "lib", "v0.1.0-release.mjs"), releaseLibrary);
  copyFileSync(CLI, cli);
  copyFileSync(path.join(ROOT, "package.json"), path.join(root, "package.json"));
  copyFileSync(path.join(ROOT, "README.md"), path.join(root, "README.md"));
  copyFileSync(path.join(SCENARIO, "incident.json"), path.join(scenario, "incident.json"));

  const fixture = readJson(path.join(SCENARIO, "replay-fixture.json"));
  options?.fixture?.(fixture);
  writeJson(path.join(scenario, "replay-fixture.json"), fixture);

  if (options?.atomicRenameHook) {
    const wrapper = path.join(root, "bin", "python3");
    mkdirSync(path.dirname(wrapper), { recursive: true });
    writeFileSync(
      wrapper,
      `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";

${options.atomicRenameHook}
const result = spawnSync("/usr/bin/python3", process.argv.slice(2), {
  stdio: "inherit",
});
process.exitCode = result.status ?? 2;
`,
      { mode: 0o755 },
    );
    writeFileSync(
      script,
      readFileSync(script, "utf8").replace(
        'const PYTHON = "/usr/bin/python3";',
        `const PYTHON = ${JSON.stringify(wrapper)};`,
      ),
    );
  }

  if (options?.platform) {
    writeFileSync(
      script,
      readFileSync(script, "utf8").replace(
        "const PLATFORM = process.platform;",
        `const PLATFORM = ${JSON.stringify(options.platform)};`,
      ),
    );
  }

  if (options?.cliHook) {
    const realCli = path.join(path.dirname(cli), "changesafe-real.js");
    copyFileSync(cli, realCli);
    writeFileSync(
      cli,
      `#!/usr/bin/env node
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const { run } = await import("./changesafe-real.js");
const status = await run(args);
if (status === 0) {
${options.cliHook}
}
process.exitCode = status;
`,
    );
  }

  symlinkSync(path.join(ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  initializeGitRepository(root);
  return { root, script };
}

function runBuilder(
  repository: BuilderRepository,
  out: string,
  key: TemporaryKey,
  envOverrides: Record<string, string | undefined> = {},
): string {
  return execFileSync(process.execPath, [repository.script, "--out", out], {
    cwd: repository.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CHANGESAFE_DEMO_SIGNING_KEY: key.privatePath,
      CHANGESAFE_DEMO_PUBLIC_KEY: key.publicPath,
      CHANGESAFE_DEMO_CREATED_AT: CREATED_AT,
      ...envOverrides,
    },
  });
}

function rawSha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function manifestDigest(manifest: Record<string, unknown>): string {
  const unsigned = { ...manifest };
  delete unsigned.manifestSha256;
  return createHash("sha256").update(canonicalForTest(unsigned), "utf8").digest("hex");
}

function canonicalForTest(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalForTest(entry)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalForTest(entry)}`)
    .join(",")}}`;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function refreshManifest(directory: string): void {
  const manifestPath = path.join(directory, "provenance.json");
  const manifest = readJson(manifestPath);
  manifest.files = Object.fromEntries(
    PROTECTED_FILES.map((name) => [name, rawSha256(path.join(directory, name))]),
  );
  manifest.manifestSha256 = manifestDigest(manifest);
  writeJson(manifestPath, manifest);
}

async function buildTemporaryBundle(): Promise<TemporaryBundle> {
  await buildCliOnce();
  const root = temporaryDirectory();
  const directory = path.join(root, "verification", "v0.1.0");
  mkdirSync(directory, { recursive: true });

  const keyBase = path.join(root, "demo");
  const keygen = JSON.parse(
    runCli(["keygen", "--out", keyBase, "--format", "json"]),
  ) as {
    privateKey: string;
    publicKey: string;
    publicKeyId: string;
  };

  copyFileSync(path.join(SCENARIO, "incident.json"), path.join(directory, "input.json"));
  copyFileSync(
    path.join(SCENARIO, "replay-fixture.json"),
    path.join(directory, "replay-fixture.json"),
  );
  copyFileSync(keygen.publicKey, path.join(directory, "demo.pub.pem"));
  writeFileSync(path.join(directory, "fingerprint.txt"), `${keygen.publicKeyId}\n`);
  writeFileSync(
    path.join(directory, "README.md"),
    "Run `npm run verify:v0.1.0` from the ChangeSafe repository root.\n",
  );

  const signedReceiptPath = path.join(directory, "receipt.signed.json");
  runCli([
    "gate",
    "--domain",
    "network",
    "--input",
    path.join(directory, "input.json"),
    "--proposal",
    path.join(directory, "replay-fixture.json"),
    "--source-id",
    SOURCE_ID,
    "--receipt",
    signedReceiptPath,
    "--sign-key",
    keygen.privateKey,
    "--receipt-id",
    RECEIPT_ID,
    "--created-at",
    CREATED_AT,
    // The same identity the real builder stamps. This stands in for the
    // published v0.1.0 bundle, and a bundle that named today's build would
    // not be one — the manifest schema says so, which is how the omission
    // was found.
    "--app-version",
    APP_VERSION,
    "--format",
    "json",
  ]);

  const fixture = readJson(path.join(directory, "replay-fixture.json"));
  const signed = readJson(signedReceiptPath) as {
    receipt: Record<string, unknown>;
  };
  const manifest: Record<string, unknown> = {
    bundleVersion: "v0.1.0",
    schemaVersion: 1,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    receiptCreatedAtUtc: CREATED_AT,
    scenarioId: SOURCE_ID,
    fixtureId: fixture.fixtureId,
    fixtureProvenance: fixture.provenance,
    provider: "openai",
    model: fixture.model,
    appVersion: signed.receipt.appVersion,
    policyVersion: signed.receipt.policyVersion,
    publicKeyId: keygen.publicKeyId,
    verificationCommand: "npm run verify:v0.1.0",
    files: Object.fromEntries(
      PROTECTED_FILES.map((name) => [name, rawSha256(path.join(directory, name))]),
    ),
    manifestSha256: "0".repeat(64),
  };
  manifest.manifestSha256 = manifestDigest(manifest);
  writeJson(path.join(directory, "provenance.json"), manifest);

  return { directory, privateKey: keygen.privateKey };
}

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("v0.1.0 public verification bundle", () => {
  it("replays and verifies a public bundle without the private key", async () => {
    const bundle = await buildTemporaryBundle();
    rmSync(bundle.privateKey, { force: true });

    const summary = await verifyBundle({
      repoRoot: ROOT,
      bundleDir: bundle.directory,
      compareTag: false,
    });

    expect(summary.ok).toBe(true);
    expect(summary.publicKeyId).toMatch(/^[a-f0-9]{32}$/);
    expect(summary.receiptId).toBe(RECEIPT_ID);
  });

  it.each(PROTECTED_FILES)("rejects mutation of %s", async (name) => {
    const bundle = await buildTemporaryBundle();
    appendFileSync(path.join(bundle.directory, name), "\nmutation\n");

    await expect(
      verifyBundle({ repoRoot: ROOT, bundleDir: bundle.directory, compareTag: false }),
    ).rejects.toThrow(/verification failed: bundle file hashes/i);
  });

  it("checks manifest integrity before trusting its file hashes", async () => {
    const bundle = await buildTemporaryBundle();
    const manifestPath = path.join(bundle.directory, "provenance.json");
    const manifest = readJson(manifestPath) as {
      files: Record<string, string>;
    };
    manifest.files["README.md"] = "0".repeat(64);
    writeJson(manifestPath, manifest);
    appendFileSync(path.join(bundle.directory, "README.md"), "\nmutation\n");

    await expect(
      verifyBundle({ repoRoot: ROOT, bundleDir: bundle.directory, compareTag: false }),
    ).rejects.toThrow(/verification failed: manifest integrity/i);
  });

  it("rejects tag-comparison traversal before file processing even when no tag exists", async () => {
    const bundle = await buildTemporaryBundle();
    writeFileSync(path.join(bundle.directory, "unexpected.txt"), "later file-set failure");
    mkdirSync(path.join(bundle.directory, "child"));

    for (const repoRoot of [ROOT, path.join(bundle.directory, "child")]) {
      const error = await verifyBundle({
        repoRoot,
        bundleDir: bundle.directory,
        compareTag: true,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("verification failed: bundle path");
      expect((error as Error).message).not.toContain(bundle.directory);
    }
  });

  it("anchors tag comparison to the requested path instead of an in-repo symlink target", async () => {
    const bundle = await buildTemporaryBundle();
    const repoRoot = realpathSync(temporaryDirectory());
    const target = path.join(repoRoot, "artifacts", "different-bundle-path");
    const requested = path.join(repoRoot, "verification", "v0.1.0");
    const cli = path.join(repoRoot, "packages", "cli", "dist", "changesafe.js");

    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(bundle.directory, target, { recursive: true });
    mkdirSync(path.dirname(requested), { recursive: true });
    symlinkSync("../artifacts/different-bundle-path", requested, "dir");
    mkdirSync(path.dirname(cli), { recursive: true });
    copyFileSync(CLI, cli);
    writeJson(path.join(repoRoot, "packages", "cli", "package.json"), {
      type: "module",
    });

    execFileSync("git", ["init", "--quiet"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "ChangeSafe Test"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "test@changesafe.invalid"], {
      cwd: repoRoot,
    });
    execFileSync("git", ["add", "."], { cwd: repoRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "tag fixture"], { cwd: repoRoot });
    execFileSync("git", ["tag", "v0.1.0"], { cwd: repoRoot });

    const error = await verifyBundle({
      repoRoot,
      bundleDir: requested,
      compareTag: true,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("verification failed: tag comparison");
    expect((error as Error).message).not.toContain(target);
    expect((error as Error).message).not.toContain(requested);
  });

  it("requires the exact public file set before hashing files", async () => {
    const bundle = await buildTemporaryBundle();
    writeFileSync(path.join(bundle.directory, "private.pem"), "must not ship");
    appendFileSync(path.join(bundle.directory, "README.md"), "\nmutation\n");

    await expect(
      verifyBundle({ repoRoot: ROOT, bundleDir: bundle.directory, compareTag: false }),
    ).rejects.toThrow(/verification failed: bundle file set/i);
  });

  it("rejects a manifest hash mutation", async () => {
    const bundle = await buildTemporaryBundle();
    const manifestPath = path.join(bundle.directory, "provenance.json");
    const manifest = readJson(manifestPath);
    manifest.manifestSha256 = "f".repeat(64);
    writeJson(manifestPath, manifest);

    await expect(
      verifyBundle({ repoRoot: ROOT, bundleDir: bundle.directory, compareTag: false }),
    ).rejects.toThrow(/verification failed: manifest integrity/i);
  });

  it("rejects a swapped public key even when file and manifest hashes are refreshed", async () => {
    const bundle = await buildTemporaryBundle();
    const otherBase = path.join(path.dirname(bundle.directory), "other");
    const other = JSON.parse(
      runCli(["keygen", "--out", otherBase, "--format", "json"]),
    ) as { publicKey: string };
    copyFileSync(other.publicKey, path.join(bundle.directory, "demo.pub.pem"));
    refreshManifest(bundle.directory);

    await expect(
      verifyBundle({ repoRoot: ROOT, bundleDir: bundle.directory, compareTag: false }),
    ).rejects.toThrow(/verification failed: public key fingerprint/i);
  });

  it("rejects an altered receipt even when its raw file hash is refreshed", async () => {
    const bundle = await buildTemporaryBundle();
    const receiptPath = path.join(bundle.directory, "receipt.signed.json");
    const signed = readJson(receiptPath) as {
      receipt: Record<string, unknown>;
    };
    signed.receipt.sourceId = "altered-source";
    writeJson(receiptPath, signed);
    refreshManifest(bundle.directory);

    await expect(
      verifyBundle({ repoRoot: ROOT, bundleDir: bundle.directory, compareTag: false }),
    ).rejects.toThrow(/verification failed: receipt metadata/i);
  });

  it("rejects replacing only the proposal in a re-hashed replay fixture", async () => {
    const bundle = await buildTemporaryBundle();
    const fixturePath = path.join(bundle.directory, "replay-fixture.json");
    const fixture = readJson(fixturePath) as {
      proposal: Record<string, unknown>;
    };
    fixture.proposal.summary = `${String(fixture.proposal.summary)} Changed.`;
    writeJson(fixturePath, fixture);
    refreshManifest(bundle.directory);

    await expect(
      verifyBundle({ repoRoot: ROOT, bundleDir: bundle.directory, compareTag: false }),
    ).rejects.toThrow(/verification failed: receipt replay/i);
  });

  it("never exposes provider secrets, subprocess arguments, or subprocess stderr", async () => {
    const bundle = await buildTemporaryBundle();
    const fixturePath = path.join(bundle.directory, "replay-fixture.json");
    const fixture = readJson(fixturePath) as {
      proposal: {
        diagnosis: { evidenceIds: string[] };
      };
    };
    fixture.proposal.diagnosis.evidenceIds = ["SECRET_STDERR_MARKER"];
    writeJson(fixturePath, fixture);
    refreshManifest(bundle.directory);

    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "SECRET_PROVIDER_KEY";
    try {
      const error = await verifyBundle({
        repoRoot: ROOT,
        bundleDir: bundle.directory,
        compareTag: false,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toBe("verification failed: replay gate");
      expect(message).not.toContain("SECRET_PROVIDER_KEY");
      expect(message).not.toContain("SECRET_STDERR_MARKER");
      expect(message).not.toContain("--proposal");
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it("captures subprocess output and bounds execution time without logging arguments", async () => {
    const captured = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      { cwd: ROOT },
    );
    expect(captured).toMatchObject({
      code: 0,
      stdout: "out",
      stderr: "err",
      timedOut: false,
    });

    const timed = await runCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1_000)"],
      { cwd: ROOT, timeoutMs: 20 },
    );
    expect(timed.timedOut).toBe(true);
    expect(timed.signal).toBe("SIGTERM");
  });

  it("canonicalizes recursively and hashes UTF-8 text", () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: null })).toBe(
      '{"a":null,"z":[{"a":1,"b":2}]}',
    );
    expect(sha256Text("ChangeSafe")).toBe(
      "60f391e27ed97ae698df8f0f027f20c8108325e5cb4031495d964b72243569f9",
    );
  });
});

describe("v0.1.0 bundle builder", () => {
  it("builds and immediately verifies a bundle with out-of-band key paths", async () => {
    await buildCliOnce();
    const repository = createBuilderRepository();
    const key = generateTemporaryKey();
    const out = path.join(temporaryDirectory(), "v0.1.0");

    const result = runBuilder(repository, out, key);

    expect(result).toContain("bundle built and verified");
    expect(readdirSync(out).sort()).toEqual([
      "README.md",
      "demo.pub.pem",
      "fingerprint.txt",
      "input.json",
      "provenance.json",
      "receipt.signed.json",
      "replay-fixture.json",
    ]);

    const privateKey = readFileSync(key.privatePath, "utf8");
    for (const name of readdirSync(out)) {
      const published = readFileSync(path.join(out, name), "utf8");
      expect(published).not.toContain(privateKey);
      expect(published).not.toContain(key.privatePath);
    }
  });

  it("refuses to overwrite any existing bundle", async () => {
    await buildCliOnce();
    const repository = createBuilderRepository();
    const key = generateTemporaryKey();
    const out = temporaryDirectory();
    writeFileSync(path.join(out, "keep.txt"), "owner data");

    expect(() => runBuilder(repository, out, key)).toThrow();
    expect(readFileSync(path.join(out, "keep.txt"), "utf8")).toBe("owner data");
  });

  it.each([
    "CHANGESAFE_DEMO_SIGNING_KEY",
    "CHANGESAFE_DEMO_PUBLIC_KEY",
    "CHANGESAFE_DEMO_CREATED_AT",
  ])("rejects a missing %s before publishing the bundle", async (missing) => {
    await buildCliOnce();
    const repository = createBuilderRepository();
    const key = generateTemporaryKey();
    const out = path.join(temporaryDirectory(), "v0.1.0");

    expect(() => runBuilder(repository, out, key, { [missing]: "" })).toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it("rejects a dirty source worktree before publishing the bundle", async () => {
    await buildCliOnce();
    const repository = createBuilderRepository();
    const key = generateTemporaryKey();
    const out = path.join(temporaryDirectory(), "v0.1.0");
    appendFileSync(path.join(repository.root, "README.md"), "\ndirty\n");

    expect(() => runBuilder(repository, out, key)).toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it("rejects a public/private key mismatch before publishing the bundle", async () => {
    await buildCliOnce();
    const repository = createBuilderRepository();
    const signingKey = generateTemporaryKey();
    const otherKey = generateTemporaryKey();
    const out = path.join(temporaryDirectory(), "v0.1.0");

    expect(() =>
      runBuilder(repository, out, {
        privatePath: signingKey.privatePath,
        publicPath: otherKey.publicPath,
      }),
    ).toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it("rejects a private PEM supplied as the public key before publishing", async () => {
    await buildCliOnce();
    const repository = createBuilderRepository();
    const key = generateTemporaryKey();
    const out = path.join(temporaryDirectory(), "v0.1.0");

    expect(() =>
      runBuilder(repository, out, {
        privatePath: key.privatePath,
        publicPath: key.privatePath,
      }),
    ).toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it("rejects a private key mode broader than 0600 before publishing the bundle", async () => {
    await buildCliOnce();
    const repository = createBuilderRepository();
    const key = generateTemporaryKey();
    const out = path.join(temporaryDirectory(), "v0.1.0");
    chmodSync(key.privatePath, 0o640);

    expect(() => runBuilder(repository, out, key)).toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it("redacts private-key values and paths from builder failures", async () => {
    await buildCliOnce();
    const repository = createBuilderRepository();
    const key = generateTemporaryKey();
    const out = path.join(temporaryDirectory(), "v0.1.0");
    const secret = "SECRET_PRIVATE_KEY_MATERIAL";
    writeFileSync(key.privatePath, secret, { mode: 0o600 });

    const error = (() => {
      try {
        runBuilder(repository, out, key);
      } catch (caught) {
        return caught as Error & { stderr?: string };
      }
      throw new Error("builder unexpectedly succeeded");
    })();

    expect(error.stderr).toBe("bundle build failed: signing key pair\n");
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(key.privatePath);
    expect(existsSync(out)).toBe(false);
  });

  it("rejects a non-captured fixture before publishing the bundle", async () => {
    await buildCliOnce();
    const repository = createBuilderRepository({
      fixture(fixture) {
        fixture.provenance = "authored";
        fixture.model = null;
        fixture.capturedAtUtc = null;
      },
    });
    const key = generateTemporaryKey();
    const out = path.join(temporaryDirectory(), "v0.1.0");

    expect(() => runBuilder(repository, out, key)).toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it.each(["directory", "symlink"])(
    "preserves a concurrently appearing target %s while holding the publication lock",
    async (kind) => {
      await buildCliOnce();
      const parent = temporaryDirectory();
      const out = path.join(parent, "v0.1.0");
      const lock = `${out}.lock`;
      const decoy = path.join(parent, "decoy");
      mkdirSync(decoy);
      writeFileSync(path.join(decoy, "keep.txt"), "owner data");
      const targetHook = kind === "directory"
        ? `mkdirSync(${JSON.stringify(out)}); writeFileSync(${JSON.stringify(path.join(out, "keep.txt"))}, "owner data");`
        : `symlinkSync(${JSON.stringify(decoy)}, ${JSON.stringify(out)}, "dir");`;
      const repository = createBuilderRepository({
        cliHook: `  if (args[0] === "verify" && existsSync(${JSON.stringify(lock)})) {
    ${targetHook}
  }`,
      });
      const key = generateTemporaryKey();

      expect(() => runBuilder(repository, out, key)).toThrow();
      expect(readFileSync(path.join(out, "keep.txt"), "utf8")).toBe("owner data");
      expect(lstatSync(out).isSymbolicLink()).toBe(kind === "symlink");
      expect(existsSync(lock)).toBe(false);
    },
  );

  it.each(["directory", "symlink"])(
    "atomically refuses a target %s injected inside the no-replace publication call",
    async (kind) => {
      await buildCliOnce();
      const parent = temporaryDirectory();
      const out = path.join(parent, "v0.1.0");
      const decoy = path.join(parent, "decoy");
      mkdirSync(decoy);
      writeFileSync(path.join(decoy, "keep.txt"), "owner data");
      const injection = kind === "directory"
        ? `mkdirSync(${JSON.stringify(out)}); writeFileSync(${JSON.stringify(path.join(out, "keep.txt"))}, "owner data");`
        : `symlinkSync(${JSON.stringify(decoy)}, ${JSON.stringify(out)}, "dir");`;
      const repository = createBuilderRepository({
        atomicRenameHook: injection,
      });
      const key = generateTemporaryKey();

      expect(() => runBuilder(repository, out, key)).toThrow();
      expect(readFileSync(path.join(out, "keep.txt"), "utf8")).toBe("owner data");
      expect(lstatSync(out).isSymbolicLink()).toBe(kind === "symlink");
      expect(existsSync(`${out}.lock`)).toBe(false);
    },
  );

  it("fails closed when the atomic no-replace publication primitive is unavailable", async () => {
    await buildCliOnce();
    const out = path.join(temporaryDirectory(), "v0.1.0");
    const repository = createBuilderRepository({
      atomicRenameHook: "process.exit(69);",
    });
    const key = generateTemporaryKey();

    const error = (() => {
      try {
        runBuilder(repository, out, key);
      } catch (caught) {
        return caught as Error & { stderr?: string };
      }
      throw new Error("builder unexpectedly succeeded");
    })();

    expect(error.stderr).toBe("bundle build failed: atomic publication\n");
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.lock`)).toBe(false);
    expect(existsSync(key.privatePath)).toBe(true);
    expect(existsSync(key.publicPath)).toBe(true);
  });

  it.each([
    ["darwin", "renameatx_np", "RENAME_EXCL"],
    ["linux", "renameat2", "RENAME_NOREPLACE"],
  ] as const)(
    "selects the %s native no-replace publication branch",
    async (platform, expectedSymbol, expectedFlag) => {
      await buildCliOnce();
      const out = path.join(temporaryDirectory(), "v0.1.0");
      const repository = createBuilderRepository({
        platform,
        atomicRenameHook: `
const program = process.argv[3] ?? "";
if (
  !program.includes(${JSON.stringify(expectedSymbol)}) ||
  !program.includes(${JSON.stringify(expectedFlag)})
) process.exit(68);
const source = process.argv[4];
const target = process.argv[5];
if (!source || !target || existsSync(target)) process.exit(1);
renameSync(source, target);
process.exit(0);
`,
      });
      const key = generateTemporaryKey();

      const result = runBuilder(repository, out, key);

      expect(result).toContain("bundle built and verified");
      expect(readdirSync(out).sort()).toEqual([
        "README.md",
        "demo.pub.pem",
        "fingerprint.txt",
        "input.json",
        "provenance.json",
        "receipt.signed.json",
        "replay-fixture.json",
      ]);
    },
  );

  it("fails closed on a platform without a native no-replace primitive", async () => {
    await buildCliOnce();
    const out = path.join(temporaryDirectory(), "v0.1.0");
    const repository = createBuilderRepository({ platform: "win32" });
    const key = generateTemporaryKey();

    const error = (() => {
      try {
        runBuilder(repository, out, key);
      } catch (caught) {
        return caught as Error & { stderr?: string };
      }
      throw new Error("builder unexpectedly succeeded");
    })();

    expect(error.stderr).toBe(
      "bundle build failed: atomic publication unavailable\n",
    );
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.lock`)).toBe(false);
    expect(existsSync(key.privatePath)).toBe(true);
    expect(existsSync(key.publicPath)).toBe(true);
  });

  it("publishes the recorded commit bytes even if the source fixture changes mid-build", async () => {
    await buildCliOnce();
    const out = path.join(temporaryDirectory(), "v0.1.0");
    const repository = createBuilderRepository({
      cliHook: `  if (args[0] === "gate" && !args.includes("--receipt")) {
    appendFileSync(path.join(repoRoot, "scenarios", "network", "scenario-a-failover", "replay-fixture.json"), "\\n ");
  }`,
    });
    const sourceFixture = path.join(
      repository.root,
      "scenarios",
      "network",
      "scenario-a-failover",
      "replay-fixture.json",
    );
    const key = generateTemporaryKey();

    runBuilder(repository, out, key);

    const manifest = readJson(path.join(out, "provenance.json"));
    const sourceCommit = String(manifest.sourceCommit);
    const committedFixture = execFileSync(
      "git",
      [
        "show",
        `${sourceCommit}:scenarios/network/scenario-a-failover/replay-fixture.json`,
      ],
      { cwd: repository.root, encoding: "utf8" },
    );
    expect(readFileSync(sourceFixture, "utf8")).not.toBe(committedFixture);
    expect(readFileSync(path.join(out, "replay-fixture.json"), "utf8")).toBe(
      committedFixture,
    );
  });

  itWherePermissionsApply("surfaces sanitized staging cleanup failure after a late target race", async () => {
    await buildCliOnce();
    const parent = temporaryDirectory();
    const out = path.join(parent, "v0.1.0");
    const lock = `${out}.lock`;
    const repository = createBuilderRepository({
      cliHook: `  if (args[0] === "verify" && existsSync(${JSON.stringify(lock)})) {
    mkdirSync(${JSON.stringify(out)});
    writeFileSync(${JSON.stringify(path.join(out, "keep.txt"))}, "owner data");
    chmodSync(${JSON.stringify(parent)}, 0o500);
  }`,
    });
    const key = generateTemporaryKey();
    const privateBefore = readFileSync(key.privatePath, "utf8");
    const publicBefore = readFileSync(key.publicPath, "utf8");

    let error: Error & { stderr?: string };
    try {
      runBuilder(repository, out, key);
      throw new Error("builder unexpectedly succeeded");
    } catch (caught) {
      error = caught as Error & { stderr?: string };
    } finally {
      chmodSync(parent, 0o700);
    }

    expect(error.stderr).toBe(
      "bundle build failed: cleanup (staging, publication lock)\n",
    );
    expect(error.stderr).not.toContain(parent);
    expect(error.stderr).not.toContain(key.privatePath);
    expect(readFileSync(path.join(out, "keep.txt"), "utf8")).toBe("owner data");
    expect(readFileSync(key.privatePath, "utf8")).toBe(privateBefore);
    expect(readFileSync(key.publicPath, "utf8")).toBe(publicBefore);
    expect(lstatSync(lock).isFile()).toBe(true);
  });
});
