import { spawn } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

export const VERSION = "v0.1.0";
export const RECEIPT_ID = "rcpt-v0-1-0-demo";
export const SOURCE_ID = "scenario-a-failover";
/**
 * The build identity this snapshot's receipt records, pinned here rather than
 * inherited from whatever CLI is running.
 *
 * Verification replays the receipt with the *current* CLI and requires the
 * result to be canonically identical, so every field inside the receipt has
 * to be reproducible — including the one that names the build. Left to
 * default, the first release that bumps the CLI version would fail this
 * check, and the only ways out would be freezing the version string forever
 * (a receipt that lies about which build made it) or giving up byte
 * equality (the strongest thing this snapshot proves). Pinning it keeps the
 * claim exact: told to stamp the same identity, today's gate reproduces this
 * receipt to the byte.
 */
export const APP_VERSION = "changesafe-cli-0.1.0";
export const VERIFY_COMMAND = "npm run verify:v0.1.0";
export const PROTECTED_FILES = [
  "README.md",
  "input.json",
  "replay-fixture.json",
  "receipt.signed.json",
  "demo.pub.pem",
  "fingerprint.txt",
];

export const CLI_RELATIVE_PATH = "packages/cli/dist/changesafe.js";
export const MANIFEST_FILE = "provenance.json";
const COMMAND_TIMEOUT_MS = 30_000;
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const CapturedFixtureMetadataSchema = z.looseObject({
  fixtureId: z.string().min(2).max(64),
  scenarioId: z.literal(SOURCE_ID),
  provenance: z.literal("captured"),
  model: z.string().min(1).max(64),
  capturedAtUtc: z.iso.datetime({ offset: true }),
});

export const SignedReceiptMetadataSchema = z.looseObject({
  receipt: z.looseObject({
    receiptId: z.literal(RECEIPT_ID),
    sourceId: z.literal(SOURCE_ID),
    createdAtUtc: z.iso.datetime({ offset: true }),
    appVersion: z.literal(APP_VERSION),
    policyVersion: z.string().min(1).max(32),
    fixtureProvenance: z.literal("captured"),
  }),
  signature: z.looseObject({
    publicKeyId: z.string().regex(/^[a-f0-9]{32}$/),
    signedAtUtc: z.iso.datetime({ offset: true }),
  }),
});

export const VerificationManifestSchema = z.strictObject({
  bundleVersion: z.literal(VERSION),
  schemaVersion: z.literal(1),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  receiptCreatedAtUtc: z.iso.datetime({ offset: true }),
  scenarioId: z.literal(SOURCE_ID),
  fixtureId: z.string().min(2).max(64),
  fixtureProvenance: z.literal("captured"),
  provider: z.literal("openai"),
  model: z.string().min(1).max(64),
  appVersion: z.literal(APP_VERSION),
  policyVersion: z.string().min(1).max(32),
  publicKeyId: z.string().regex(/^[a-f0-9]{32}$/),
  verificationCommand: z.literal(VERIFY_COMMAND),
  files: z.record(z.enum(PROTECTED_FILES), Sha256),
  manifestSha256: Sha256,
});

export class ReleaseVerificationError extends Error {
  constructor(check) {
    super(`verification failed: ${check}`);
    this.name = "ReleaseVerificationError";
  }
}

/**
 * @typedef {{
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 * }} RunCommandOptions
 */

/**
 * @param {string} file
 * @param {string[]} args
 * @param {RunCommandOptions} [options]
 */
export function runCommand(file, args, {
  cwd,
  env = process.env,
  timeoutMs = 0,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs)
      : null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

export function publicKeyIdFromPem(pem) {
  const spki = createPublicKey(pem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("hex").slice(0, 32);
}

export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function createVerificationManifest({
  bundleDir,
  sourceCommit,
  fixture,
  signedReceipt,
  publicKeyId,
}) {
  const captured = CapturedFixtureMetadataSchema.parse(fixture);
  const signed = SignedReceiptMetadataSchema.parse(signedReceipt);
  const files = Object.fromEntries(
    await Promise.all(
      PROTECTED_FILES.map(async (name) => [
        name,
        await sha256File(path.join(bundleDir, name)),
      ]),
    ),
  );
  const unsignedManifest = {
    bundleVersion: VERSION,
    schemaVersion: 1,
    sourceCommit,
    receiptCreatedAtUtc: signed.receipt.createdAtUtc,
    scenarioId: SOURCE_ID,
    fixtureId: captured.fixtureId,
    fixtureProvenance: captured.provenance,
    // Scenario A's captured fixture predates a provider field. Its capture
    // record is OpenAI-specific, while the model identifier remains fixture-owned.
    provider: "openai",
    model: captured.model,
    appVersion: signed.receipt.appVersion,
    policyVersion: signed.receipt.policyVersion,
    publicKeyId,
    verificationCommand: VERIFY_COMMAND,
    files,
  };
  return VerificationManifestSchema.parse({
    ...unsignedManifest,
    manifestSha256: sha256Text(canonicalJson(unsignedManifest)),
  });
}

async function checked(check, operation) {
  try {
    return await operation();
  } catch {
    throw new ReleaseVerificationError(check);
  }
}

function requireCheck(condition, check) {
  if (!condition) throw new ReleaseVerificationError(check);
}

async function readJson(file, check) {
  return checked(check, async () => JSON.parse(await readFile(file, "utf8")));
}

function subprocessEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/(?:API_KEY|TOKEN|SECRET)$/i.test(name)),
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrictDescendant(relativePath) {
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

/**
 * Verify an immutable public snapshot using only deterministic CLI commands
 * and the trusted public key shipped in the bundle.
 */
export async function verifyBundle({ repoRoot, bundleDir, compareTag }) {
  const manifestPath = path.join(bundleDir, MANIFEST_FILE);

  const manifest = await checked("manifest schema", async () =>
    VerificationManifestSchema.parse(await readJson(manifestPath, "manifest schema")),
  );

  const { manifestSha256, ...unsignedManifest } = manifest;
  requireCheck(
    sha256Text(canonicalJson(unsignedManifest)) === manifestSha256,
    "manifest integrity",
  );

  let tagBundlePath = null;
  if (compareTag) {
    const requestedBundlePath = path.relative(
      path.resolve(repoRoot),
      path.resolve(bundleDir),
    );
    requireCheck(isStrictDescendant(requestedBundlePath), "bundle path");

    const [realRepoRoot, realBundleDir] = await checked("bundle path", async () =>
      Promise.all([realpath(repoRoot), realpath(bundleDir)]),
    );
    requireCheck(
      isStrictDescendant(path.relative(realRepoRoot, realBundleDir)),
      "bundle path",
    );
    tagBundlePath = requestedBundlePath;
  }

  const expectedFiles = [...PROTECTED_FILES, MANIFEST_FILE].sort();
  const actualFiles = await checked("bundle file set", async () =>
    (await readdir(bundleDir)).sort(),
  );
  requireCheck(
    actualFiles.length === expectedFiles.length &&
      actualFiles.every((name, index) => name === expectedFiles[index]),
    "bundle file set",
  );

  const fileHashesMatch = await checked("bundle file hashes", async () => {
    const hashes = await Promise.all(
      PROTECTED_FILES.map(async (name) => [
        name,
        await sha256File(path.join(bundleDir, name)),
      ]),
    );
    return hashes.every(([name, digest]) => manifest.files[name] === digest);
  });
  requireCheck(fileHashesMatch, "bundle file hashes");

  const publicKeyPath = path.join(bundleDir, "demo.pub.pem");
  const publicKeyId = await checked("public key fingerprint", async () =>
    publicKeyIdFromPem(await readFile(publicKeyPath, "utf8")),
  );
  const fingerprint = await checked("public key fingerprint", async () =>
    (await readFile(path.join(bundleDir, "fingerprint.txt"), "utf8")).trim(),
  );
  requireCheck(
    /^[a-f0-9]{32}$/.test(fingerprint) &&
      publicKeyId === fingerprint &&
      publicKeyId === manifest.publicKeyId,
    "public key fingerprint",
  );

  const signedReceiptPath = path.join(bundleDir, "receipt.signed.json");
  const signed = await readJson(signedReceiptPath, "signed receipt");
  const fixture = await readJson(
    path.join(bundleDir, "replay-fixture.json"),
    "replay fixture",
  );
  requireCheck(
    isRecord(signed) &&
      isRecord(signed.receipt) &&
      isRecord(signed.signature) &&
      isRecord(fixture) &&
      signed.receipt.receiptId === RECEIPT_ID &&
      signed.receipt.createdAtUtc === manifest.receiptCreatedAtUtc &&
      signed.signature.signedAtUtc === manifest.receiptCreatedAtUtc &&
      signed.receipt.sourceId === manifest.scenarioId &&
      signed.receipt.appVersion === manifest.appVersion &&
      signed.receipt.policyVersion === manifest.policyVersion &&
      signed.receipt.fixtureProvenance === manifest.fixtureProvenance &&
      signed.receipt.mode === "offline" &&
      signed.receipt.model === null &&
      signed.signature.publicKeyId === manifest.publicKeyId &&
      fixture.fixtureId === manifest.fixtureId &&
      fixture.scenarioId === manifest.scenarioId &&
      fixture.provenance === manifest.fixtureProvenance &&
      fixture.model === manifest.model,
    "receipt metadata",
  );

  const temporaryDirectory = await checked("replay gate", async () =>
    mkdtemp(path.join(os.tmpdir(), "changesafe-v0.1.0-verify-")),
  );
  const replayedReceiptPath = path.join(temporaryDirectory, "receipt.json");
  const cli = path.join(repoRoot, CLI_RELATIVE_PATH);
  const inputPath = path.join(bundleDir, "input.json");
  const fixturePath = path.join(bundleDir, "replay-fixture.json");
  const env = subprocessEnvironment();
  let verificationComplete = false;

  try {
    const gate = await checked("replay gate", async () =>
      runCommand(
        process.execPath,
        [
          cli,
          "gate",
          "--domain", "network",
          "--input", inputPath,
          "--proposal", fixturePath,
          "--source-id", SOURCE_ID,
          "--receipt", replayedReceiptPath,
          "--receipt-id", RECEIPT_ID,
          "--created-at", manifest.receiptCreatedAtUtc,
          "--app-version", APP_VERSION,
          "--format", "json",
        ],
        { cwd: repoRoot, env, timeoutMs: COMMAND_TIMEOUT_MS },
      ),
    );
    requireCheck(
      !gate.timedOut && (gate.code === 0 || gate.code === 1),
      "replay gate",
    );
    await checked("replay gate", async () => access(replayedReceiptPath));

    const replayedReceipt = await readJson(replayedReceiptPath, "replayed receipt");
    requireCheck(
      canonicalJson(replayedReceipt) === canonicalJson(signed.receipt),
      "receipt replay",
    );

    const verification = await checked("receipt verification", async () =>
      runCommand(
        process.execPath,
        [
          cli,
          "verify", signedReceiptPath,
          "--domain", "network",
          "--input", inputPath,
          "--proposal", fixturePath,
          "--public-key", publicKeyPath,
          "--format", "json",
        ],
        { cwd: repoRoot, env, timeoutMs: COMMAND_TIMEOUT_MS },
      ),
    );
    requireCheck(
      !verification.timedOut && verification.code === 0,
      "receipt verification",
    );
    const verificationResult = await checked("receipt verification", async () =>
      JSON.parse(verification.stdout),
    );
    requireCheck(
      isRecord(verificationResult) &&
        verificationResult.ok === true &&
        isRecord(verificationResult.signature) &&
        verificationResult.signature.verdict === "valid",
      "receipt verification",
    );
    verificationComplete = true;
  } finally {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
    } catch {
      if (verificationComplete) {
        throw new ReleaseVerificationError("temporary cleanup");
      }
    }
  }

  if (compareTag) {
    if (tagBundlePath === null) {
      throw new ReleaseVerificationError("bundle path");
    }
    const tag = await checked("tag availability", async () =>
      runCommand(
        "git",
        ["rev-parse", "--verify", "--quiet", `refs/tags/${VERSION}`],
        { cwd: repoRoot, env, timeoutMs: COMMAND_TIMEOUT_MS },
      ),
    );
    requireCheck(tag.code === 0 || tag.code === 1, "tag availability");
    if (tag.code === 0) {
      for (const name of expectedFiles) {
        const tagged = await checked("tag comparison", async () =>
          runCommand(
            "git",
            ["show", `${VERSION}:${path.join(tagBundlePath, name).split(path.sep).join("/")}`],
            { cwd: repoRoot, env, timeoutMs: COMMAND_TIMEOUT_MS },
          ),
        );
        const bundled = await checked("tag comparison", async () =>
          readFile(path.join(bundleDir, name)),
        );
        requireCheck(
          tagged.code === 0 &&
            !tagged.timedOut &&
            Buffer.from(tagged.stdout, "utf8").equals(bundled),
          "tag comparison",
        );
      }
    }
  }

  return {
    ok: true,
    receiptId: signed.receipt.receiptId,
    publicKeyId,
  };
}
