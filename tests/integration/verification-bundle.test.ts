import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  PROTECTED_FILES,
  RECEIPT_ID,
  SOURCE_ID,
  canonicalJson,
  runCommand,
  sha256Text,
  verifyBundle,
} from "../../scripts/lib/v0.1.0-release.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(ROOT, "packages/cli/dist/changesafe.js");
const SCENARIO = path.join(ROOT, "scenarios/scenario-a-failover");
const CREATED_AT = "2026-07-26T12:00:00.000Z";
const temporaryDirectories: string[] = [];
let cliBuild: Promise<void> | undefined;

interface TemporaryBundle {
  directory: string;
  privateKey: string;
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
