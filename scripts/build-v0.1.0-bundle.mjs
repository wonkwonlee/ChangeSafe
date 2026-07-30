#!/usr/bin/env node

import { parseArgs } from "node:util";
import { createPublicKey } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  APP_VERSION,
  CLI_RELATIVE_PATH,
  CapturedFixtureMetadataSchema,
  RECEIPT_ID,
  SOURCE_ID,
  createVerificationManifest,
  publicKeyIdFromPem,
  runCommand,
  verifyBundle,
} from "./lib/v0.1.0-release.mjs";

const COMMAND_TIMEOUT_MS = 30_000;
const PYTHON = "/usr/bin/python3";
const PLATFORM = process.platform;
const DARWIN_RENAME_EXCL = `
import ctypes
import os
import sys

AT_FDCWD = -2
RENAME_EXCL = 0x00000004

try:
    renameatx_np = ctypes.CDLL(None, use_errno=True).renameatx_np
except AttributeError:
    sys.exit(69)

renameatx_np.argtypes = [
    ctypes.c_int,
    ctypes.c_char_p,
    ctypes.c_int,
    ctypes.c_char_p,
    ctypes.c_uint,
]
renameatx_np.restype = ctypes.c_int

result = renameatx_np(
    AT_FDCWD,
    os.fsencode(sys.argv[1]),
    AT_FDCWD,
    os.fsencode(sys.argv[2]),
    RENAME_EXCL,
)
sys.exit(0 if result == 0 else 1)
`;
const LINUX_RENAME_NOREPLACE = `
import ctypes
import os
import sys

AT_FDCWD = -100
RENAME_NOREPLACE = 0x00000001

try:
    renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
except AttributeError:
    sys.exit(69)

renameat2.argtypes = [
    ctypes.c_int,
    ctypes.c_char_p,
    ctypes.c_int,
    ctypes.c_char_p,
    ctypes.c_uint,
]
renameat2.restype = ctypes.c_int

result = renameat2(
    AT_FDCWD,
    os.fsencode(sys.argv[1]),
    AT_FDCWD,
    os.fsencode(sys.argv[2]),
    RENAME_NOREPLACE,
)
sys.exit(0 if result == 0 else 1)
`;
const REQUIRED_ENVIRONMENT = [
  "CHANGESAFE_DEMO_SIGNING_KEY",
  "CHANGESAFE_DEMO_PUBLIC_KEY",
  "CHANGESAFE_DEMO_CREATED_AT",
];
const README = (publicKeyId) => `# ChangeSafe v0.1.0 verification snapshot

This directory freezes a fictional incident input, a captured model proposal,
the deterministic gate result, and an Ed25519 signature. Verification proves
that these files agree and that the receipt was signed by the key whose
fingerprint is shown below. A public key stored beside a signature is not, by
itself, external proof of the publisher's identity; compare this fingerprint
with the v0.1.0 release notes or presentation material.

Fingerprint: \`${publicKeyId}\`

Run from the repository root:

\`\`\`bash
npm ci
npm run verify:v0.1.0
\`\`\`

The private key is intentionally absent. Public users reproduce the gate
payload and verify the frozen signature; they do not re-sign the snapshot.
`;

class BundleBuildError extends Error {
  constructor(check) {
    super(`bundle build failed: ${check}`);
    this.name = "BundleBuildError";
  }
}

function requireBuild(condition, check) {
  if (!condition) throw new BundleBuildError(check);
}

async function checked(check, operation) {
  try {
    return await operation();
  } catch {
    throw new BundleBuildError(check);
  }
}

function subprocessEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !REQUIRED_ENVIRONMENT.includes(name) &&
        !/(?:API_KEY|TOKEN|SECRET)$/i.test(name),
    ),
  );
}

async function readJson(file, check) {
  return checked(check, async () => JSON.parse(await readFile(file, "utf8")));
}

async function pathExists(file) {
  return lstat(file).then(
    () => true,
    (error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    },
  );
}

async function publishDirectoryNoReplace(source, target, { cwd, env }) {
  const program = PLATFORM === "darwin"
    ? DARWIN_RENAME_EXCL
    : PLATFORM === "linux"
      ? LINUX_RENAME_NOREPLACE
      : null;
  requireBuild(program !== null, "atomic publication unavailable");
  const publication = await checked("atomic publication", async () =>
    runCommand(PYTHON, ["-c", program, source, target], {
      cwd,
      env,
      timeoutMs: COMMAND_TIMEOUT_MS,
    }),
  );
  requireBuild(
    !publication.timedOut && publication.code === 0,
    "atomic publication",
  );
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cli = path.join(repoRoot, CLI_RELATIVE_PATH);

  const parsed = checked("arguments", async () =>
    parseArgs({
      args: process.argv.slice(2),
      options: { out: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }),
  );
  const { values } = await parsed;
  const finalDirectory = path.resolve(
    repoRoot,
    values.out ?? path.join("verification", "v0.1.0"),
  );

  const environment = Object.fromEntries(
    REQUIRED_ENVIRONMENT.map((name) => {
      const value = process.env[name];
      requireBuild(typeof value === "string" && value.length > 0, "environment");
      return [name, value];
    }),
  );
  const signingKey = path.resolve(environment.CHANGESAFE_DEMO_SIGNING_KEY);
  const publicKey = path.resolve(environment.CHANGESAFE_DEMO_PUBLIC_KEY);
  const createdAt = await checked("created time", async () =>
    z.iso.datetime({ offset: true }).parse(
      process.env.CHANGESAFE_DEMO_CREATED_AT,
    ),
  );

  requireBuild(Number(process.versions.node.split(".")[0]) === 22, "Node version");

  const env = subprocessEnvironment();
  const npmVersion = await checked("npm version", async () =>
    runCommand("npm", ["--version"], {
      cwd: repoRoot,
      env,
      timeoutMs: COMMAND_TIMEOUT_MS,
    }),
  );
  requireBuild(
    !npmVersion.timedOut &&
      npmVersion.code === 0 &&
      npmVersion.stdout.trim() === "10.9.8",
    "npm version",
  );

  const existingTarget = await checked("target", async () =>
    pathExists(finalDirectory),
  );
  requireBuild(!existingTarget, "target exists");

  const worktree = await checked("source worktree", async () =>
    runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: repoRoot,
      env,
      timeoutMs: COMMAND_TIMEOUT_MS,
    }),
  );
  requireBuild(
    !worktree.timedOut && worktree.code === 0 && worktree.stdout === "",
    "source worktree",
  );

  const sourceCommitCommand = await checked("source commit", async () =>
    runCommand("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      env,
      timeoutMs: COMMAND_TIMEOUT_MS,
    }),
  );
  const sourceCommit = sourceCommitCommand.stdout.trim();
  requireBuild(
    !sourceCommitCommand.timedOut &&
      sourceCommitCommand.code === 0 &&
      /^[a-f0-9]{40}$/.test(sourceCommit),
    "source commit",
  );

  const [sourceInputText, sourceFixtureText] = await Promise.all(
    [
      "scenarios/network/scenario-a-failover/incident.json",
      "scenarios/network/scenario-a-failover/replay-fixture.json",
    ].map(async (sourcePath) => {
      const source = await checked("committed scenario", async () =>
        runCommand("git", ["show", `${sourceCommit}:${sourcePath}`], {
          cwd: repoRoot,
          env,
          timeoutMs: COMMAND_TIMEOUT_MS,
        }),
      );
      requireBuild(
        !source.timedOut && source.code === 0,
        "committed scenario",
      );
      return source.stdout;
    }),
  );
  const fixture = await checked("captured fixture", async () =>
    CapturedFixtureMetadataSchema.parse(JSON.parse(sourceFixtureText)),
  );

  const signingKeyStat = await checked("signing key permissions", async () =>
    stat(signingKey),
  );
  requireBuild(
    signingKeyStat.isFile() && (signingKeyStat.mode & 0o077) === 0,
    "signing key permissions",
  );

  const [privatePem, publicPem] = await checked("signing key pair", async () =>
    Promise.all([readFile(signingKey, "utf8"), readFile(publicKey, "utf8")]),
  );
  requireBuild(
    publicPem.includes("-----BEGIN PUBLIC KEY-----") &&
      !publicPem.includes("PRIVATE KEY"),
    "signing key pair",
  );
  const privatePublicId = await checked("signing key pair", async () =>
    publicKeyIdFromPem(
      createPublicKey(privatePem).export({ type: "spki", format: "pem" }),
    ),
  );
  const suppliedPublicId = await checked("signing key pair", async () =>
    publicKeyIdFromPem(publicPem),
  );
  requireBuild(privatePublicId === suppliedPublicId, "signing key pair");

  const parentDirectory = path.dirname(finalDirectory);
  await checked("staging", async () => mkdir(parentDirectory, { recursive: true }));
  const publicationLock = `${finalDirectory}.lock`;
  const lockHandle = await checked("publication lock", async () =>
    open(publicationLock, "wx", 0o600),
  );
  let stagingDirectory;
  let published = false;
  let failure;

  try {
    stagingDirectory = await checked("staging", async () =>
      mkdtemp(path.join(parentDirectory, `.${path.basename(finalDirectory)}.tmp-`)),
    );
    const stagedInput = path.join(stagingDirectory, "input.json");
    const stagedFixture = path.join(stagingDirectory, "replay-fixture.json");
    const stagedPublicKey = path.join(stagingDirectory, "demo.pub.pem");
    const stagedReceipt = path.join(stagingDirectory, "receipt.signed.json");

    await checked("staging files", async () =>
      Promise.all([
        writeFile(stagedInput, sourceInputText),
        writeFile(stagedFixture, sourceFixtureText),
        copyFile(publicKey, stagedPublicKey),
      ]),
    );

    const preflight = await checked("scenario preflight", async () =>
      runCommand(
        process.execPath,
        [
          cli,
          "gate",
          "--domain", "network",
          "--input", stagedInput,
          "--proposal", stagedFixture,
          "--source-id", SOURCE_ID,
          "--format", "json",
        ],
        { cwd: repoRoot, env, timeoutMs: COMMAND_TIMEOUT_MS },
      ),
    );
    requireBuild(
      !preflight.timedOut && preflight.code === 0,
      "scenario preflight",
    );

    const gate = await checked("signed receipt", async () =>
      runCommand(
        process.execPath,
        [
          cli,
          "gate",
          "--domain", "network",
          "--input", stagedInput,
          "--proposal", stagedFixture,
          "--source-id", SOURCE_ID,
          "--receipt", stagedReceipt,
          "--sign-key", signingKey,
          "--receipt-id", RECEIPT_ID,
          "--created-at", createdAt,
          "--app-version", APP_VERSION,
          "--format", "json",
        ],
        { cwd: repoRoot, env, timeoutMs: COMMAND_TIMEOUT_MS },
      ),
    );
    requireBuild(
      !gate.timedOut && gate.code === 0,
      "signed receipt",
    );

    const signedReceipt = await readJson(stagedReceipt, "signed receipt");
    requireBuild(
      signedReceipt?.signature?.publicKeyId === suppliedPublicId,
      "signed receipt key",
    );

    await checked("public metadata", async () =>
      Promise.all([
        writeFile(
          path.join(stagingDirectory, "fingerprint.txt"),
          `${suppliedPublicId}\n`,
        ),
        writeFile(
          path.join(stagingDirectory, "README.md"),
          README(suppliedPublicId),
        ),
      ]),
    );

    const manifest = await checked("provenance manifest", async () =>
      createVerificationManifest({
        bundleDir: stagingDirectory,
        sourceCommit,
        fixture,
        signedReceipt,
        publicKeyId: suppliedPublicId,
      }),
    );
    await checked("provenance manifest", async () =>
      writeFile(
        path.join(stagingDirectory, "provenance.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      ),
    );

    await checked("bundle verification", async () =>
      verifyBundle({
        repoRoot,
        bundleDir: stagingDirectory,
        compareTag: false,
      }),
    );

    await publishDirectoryNoReplace(stagingDirectory, finalDirectory, {
      cwd: repoRoot,
      env,
    });
    published = true;
  } catch (error) {
    failure = error;
  } finally {
    const cleanupFailures = [];
    if (!published && stagingDirectory !== undefined) {
      try {
        await rm(stagingDirectory, { recursive: true, force: true });
      } catch {
        cleanupFailures.push("staging");
      }
    }
    try {
      await lockHandle.close();
    } catch {
      cleanupFailures.push("publication lock");
    }
    try {
      await unlink(publicationLock);
    } catch {
      cleanupFailures.push("publication lock");
    }
    if (cleanupFailures.length > 0) {
      const checks = [...new Set(cleanupFailures)];
      failure = new BundleBuildError(`cleanup (${checks.join(", ")})`);
    }
  }
  if (failure) throw failure;

  process.stdout.write("bundle built and verified\n");
}

main().catch((error) => {
  const message = error instanceof BundleBuildError
    ? error.message
    : "bundle build failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
