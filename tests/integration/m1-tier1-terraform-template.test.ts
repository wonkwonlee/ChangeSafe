import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ChangeReceiptSchema,
  SignedReceiptSchema,
  hashCanonical,
  verifyReceiptHash,
} from "@changesafe/core";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const EXAMPLE_ROOT = path.join(REPO_ROOT, "examples/m1-tier1-terraform-gate");
const CLI = path.join(REPO_ROOT, "packages/cli/dist/changesafe.js");

interface ManifestCase {
  caseId: string;
  plan: { path: string; sha256: string };
  context: { path: string; sha256: string } | null;
  expected: {
    exitCode: number;
    blocked: boolean;
    decision: "gate_only" | "blocked";
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    findingStatuses: Record<string, "PASS" | "WARN" | "BLOCK">;
  };
}

interface Manifest {
  schema: "changesafe-m1-tier1-template/v1";
  release: {
    package: "changesafe";
    version: string;
    npmIntegrity: string;
    gitHead: string;
    appVersion: string;
  };
  policyVersion: string;
  cases: ManifestCase[];
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function temporaryDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "changesafe-m1-tier1-"));
  temporaryDirectories.push(dir);
  return dir;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(path.join(EXAMPLE_ROOT, "evidence-manifest.json"), "utf8")) as Manifest;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function generateSigningKey(basePath: string): { publicKeyPath: string; privateKeyPath: string } {
  const keygen = spawnSync(
    "node",
    [CLI, "keygen", "--out", basePath, "--format", "json"],
    {
      cwd: EXAMPLE_ROOT,
      encoding: "utf8",
    },
  );
  expect(keygen.status, keygen.stderr).toBe(0);
  const payload = JSON.parse(keygen.stdout) as {
    publicKey: string;
    privateKey: string;
  };
  return { publicKeyPath: payload.publicKey, privateKeyPath: payload.privateKey };
}

function runBundledCli(args: string[]) {
  return spawnSync("node", [CLI, ...args], {
    cwd: EXAMPLE_ROOT,
    encoding: "utf8",
  });
}

describe("M1 Tier 1 Terraform captured-plan template", () => {
  it("records immutable release and fixture evidence for every advertised case", () => {
    const manifest = readManifest();

    expect(manifest.schema).toBe("changesafe-m1-tier1-template/v1");
    expect(manifest.release).toEqual({
      package: "changesafe",
      version: "0.5.0",
      npmIntegrity:
        "sha512-/0Fc69/BrZphQ4VbWk+1utkSLTdqD8AtAMop2xVCUCEu52lTAr32mUYM407w63TaTCVvGKgqMCYgZChbKgl6/Q==",
      gitHead: "c1ae07e9c6de14c0204f4a667eaec69e2cca59a9",
      appVersion: "changesafe-cli-0.5.0",
    });
    expect(manifest.policyVersion).toBe("core-v0.2.0+terraform-v0.2.0");
    expect(manifest.cases.map((entry) => entry.caseId)).toEqual([
      "m1-tier1-benign",
      "m1-tier1-hostile",
    ]);

    for (const entry of manifest.cases) {
      expect(sha256(path.join(EXAMPLE_ROOT, entry.plan.path))).toBe(entry.plan.sha256);
      if (entry.context) {
        expect(sha256(path.join(EXAMPLE_ROOT, entry.context.path))).toBe(entry.context.sha256);
      }
    }
  });

  it("keeps the example workflow captured-artifact-only", () => {
    const files = walkFiles(EXAMPLE_ROOT);
    for (const file of files) {
      const relative = path.relative(REPO_ROOT, file);
      const source = readFileSync(file, "utf8");
      expect(source, relative).not.toMatch(/terraform\s+apply/i);
      expect(source, relative).not.toMatch(/auto-approve/i);
      expect(source, relative).not.toMatch(/AuthorizationGrant/);
      expect(source, relative).not.toMatch(/\bAWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\b/);
    }

    const workflow = readFileSync(
      path.join(EXAMPLE_ROOT, ".github/workflows/changesafe-tier1-captured-plan.yml"),
      "utf8",
    );
    expect(workflow).toContain("npx --yes --package=changesafe@0.5.0 changesafe gate");
    expect(workflow).not.toContain("hashicorp/setup-terraform");
    expect(workflow).not.toMatch(/\bterraform\s+(init|plan|show)\b/);
    expect(workflow).not.toMatch(/uses:\s*wonkwonlee\/ChangeSafe@/);
  });

  it("keeps the GitHub Action fail-closed when the gate blocks or cannot evaluate", () => {
    const action = readFileSync(path.join(REPO_ROOT, "action.yml"), "utf8");

    expect(action).toContain("CHANGESAFE_FAIL_ON_BLOCK: ${{ inputs.fail-on-block }}");
    expect(action).toContain("if [ \"$CODE\" -eq 2 ]; then");
    expect(action).toContain("exit 2");
    expect(action).toContain("if [ \"$BLOCKED\" = \"true\" ] && [ \"$CHANGESAFE_FAIL_ON_BLOCK\" = \"true\" ]; then");
    expect(action).toContain("exit 1");
    expect(action).toContain("if-no-files-found: warn");
  });

  it.runIf(statSync(CLI, { throwIfNoEntry: false })?.isFile())(
    "reproduces the benign and hostile verdicts through the bundled CLI",
    async () => {
      const manifest = readManifest();

      for (const entry of manifest.cases) {
        const dir = temporaryDir();
        const signingKeyBase = path.join(dir, "hostile-signing-key");
        let publicKeyPath: string | null = null;
        let privateKeyPath: string | null = null;
        if (entry.caseId === "m1-tier1-hostile") {
          const signingKey = generateSigningKey(signingKeyBase);
          publicKeyPath = signingKey.publicKeyPath;
          privateKeyPath = signingKey.privateKeyPath;
        }

        const receipt = path.join(dir, `${entry.caseId}.receipt.json`);
        const args = [
          CLI,
          "gate",
          "--domain",
          "terraform",
          "--input",
          path.join(EXAMPLE_ROOT, entry.plan.path),
          "--receipt",
          receipt,
          "--format",
          "json",
        ];
        if (entry.context) {
          args.push("--context", path.join(EXAMPLE_ROOT, entry.context.path));
        }
        if (privateKeyPath) {
          args.push("--sign-key", privateKeyPath);
        }

        const result = spawnSync("node", args, {
          cwd: EXAMPLE_ROOT,
          encoding: "utf8",
        });
        expect(result.status, `${entry.caseId}: ${result.stderr}`).toBe(entry.expected.exitCode);

        const payload = JSON.parse(result.stdout) as {
          blocked: boolean;
          decision: string;
          riskLevel: string;
          findings: { policyId: string; status: "PASS" | "WARN" | "BLOCK" }[];
        };
        expect(payload.blocked).toBe(entry.expected.blocked);
        expect(payload.decision).toBe(entry.expected.decision);
        expect(payload.riskLevel).toBe(entry.expected.riskLevel);
        expect(Object.fromEntries(payload.findings.map((finding) => [finding.policyId, finding.status]))).toEqual(
          entry.expected.findingStatuses,
        );

        const rawReceipt = JSON.parse(readFileSync(receipt, "utf8"));
        const parsedReceipt = privateKeyPath
          ? SignedReceiptSchema.parse(rawReceipt).receipt
          : ChangeReceiptSchema.parse(rawReceipt);
        expect(parsedReceipt.decision).toBe(entry.expected.decision);
        expect(parsedReceipt.riskLevel).toBe(entry.expected.riskLevel);
        expect(parsedReceipt.policyVersion).toBe(manifest.policyVersion);
        expect(parsedReceipt.appVersion).toBe(manifest.release.appVersion);
        expect(parsedReceipt.mode).toBe("offline");
        expect(parsedReceipt.simulation).toBeNull();
        expect(await verifyReceiptHash(parsedReceipt)).toBe(true);

        if (publicKeyPath) {
          const verified = spawnSync(
            "node",
            [
              CLI,
              "verify",
              receipt,
              "--public-key",
              publicKeyPath,
              "--format",
              "json",
            ],
            {
              cwd: EXAMPLE_ROOT,
              encoding: "utf8",
            },
          );
          expect(verified.status, verified.stderr).toBe(0);
          const verification = JSON.parse(verified.stdout) as {
            ok: boolean;
            signature: { verdict: string } | null;
          };
          expect(verification.ok).toBe(true);
          expect(verification.signature?.verdict).toBe("valid");
        }
      }
    },
  );

  it.runIf(statSync(CLI, { throwIfNoEntry: false })?.isFile())(
    "rejects a hostile signed receipt whose contents were tampered after signing",
    async () => {
      const dir = temporaryDir();
      const manifest = readManifest();
      const hostile = manifest.cases.find((entry) => entry.caseId === "m1-tier1-hostile");
      expect(hostile).toBeDefined();
      if (!hostile) return;
      const signingKey = generateSigningKey(path.join(dir, "hostile-signing-key"));
      const receipt = path.join(dir, "hostile.receipt.json");

      const result = runBundledCli([
        "gate",
        "--domain",
        "terraform",
        "--input",
        path.join(EXAMPLE_ROOT, hostile.plan.path),
        "--context",
        hostile.context ? path.join(EXAMPLE_ROOT, hostile.context.path) : "",
        "--receipt",
        receipt,
        "--sign-key",
        signingKey.privateKeyPath,
        "--format",
        "json",
      ]);
      expect(result.status, result.stderr).toBe(hostile.expected.exitCode);

      const envelope = SignedReceiptSchema.parse(JSON.parse(readFileSync(receipt, "utf8")));
      const tampered = {
        ...envelope,
        receipt: {
          ...envelope.receipt,
          riskLevel: "LOW",
        },
      };
      const { receiptSha256, ...receiptWithoutHash } = tampered.receipt;
      expect(receiptSha256).toBe(envelope.receipt.receiptSha256);
      tampered.receipt.receiptSha256 = await hashCanonical(receiptWithoutHash);
      writeFileSync(receipt, JSON.stringify(tampered));

      const verified = runBundledCli([
        "verify",
        receipt,
        "--public-key",
        signingKey.publicKeyPath,
        "--format",
        "json",
      ]);
      expect(verified.status, verified.stderr).toBe(1);
      const verification = JSON.parse(verified.stdout) as {
        ok: boolean;
        signature: { verdict: string } | null;
        checks: { name: string; ok: boolean }[];
      };
      expect(verification.ok).toBe(false);
      expect(verification.checks.find((check) => check.name === "receipt hash")?.ok).toBe(true);
      expect(verification.signature?.verdict).toBe("invalid");
    },
  );

  it.runIf(statSync(CLI, { throwIfNoEntry: false })?.isFile())(
    "fails safely when the captured plan artifact is missing",
    () => {
      const dir = temporaryDir();
      const receipt = path.join(dir, "missing.receipt.json");
      const result = runBundledCli([
        "gate",
        "--domain",
        "terraform",
        "--input",
        path.join(EXAMPLE_ROOT, "fixtures/missing.tfplan.json"),
        "--receipt",
        receipt,
        "--format",
        "json",
      ]);

      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/cannot read plan/i);
      expect(statSync(receipt, { throwIfNoEntry: false })).toBeUndefined();
    },
  );

  it.runIf(statSync(CLI, { throwIfNoEntry: false })?.isFile())(
    "fails safely when the captured plan artifact is malformed",
    () => {
      const dir = temporaryDir();
      const receipt = path.join(dir, "malformed.receipt.json");
      const result = runBundledCli([
        "gate",
        "--domain",
        "terraform",
        "--input",
        path.join(EXAMPLE_ROOT, "fixtures/malformed-plan.json"),
        "--receipt",
        receipt,
        "--format",
        "json",
      ]);

      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/not valid JSON/i);
      expect(statSync(receipt, { throwIfNoEntry: false })).toBeUndefined();
    },
  );

  it.runIf(statSync(CLI, { throwIfNoEntry: false })?.isFile())(
    "shows that policy-pack selection is not bound into a receipt",
    () => {
      const dir = temporaryDir();
      const defaultReceiptPath = path.join(dir, "default.receipt.json");
      const strictReceiptPath = path.join(dir, "strict.receipt.json");
      const strictPackPath = path.join(dir, "strict-policy-pack.json");
      writeFileSync(
        strictPackPath,
        JSON.stringify({ name: "m1-strict", blastRadius: { warnAt: 1, blockAbove: 3 } }),
      );

      const gateArgs = [
        "gate",
        "--domain",
        "terraform",
        "--input",
        path.join(EXAMPLE_ROOT, "fixtures/benign-scale-up.tfplan.json"),
        "--format",
        "json",
      ];
      const defaultResult = runBundledCli([...gateArgs, "--receipt", defaultReceiptPath]);
      const strictResult = runBundledCli([
        ...gateArgs,
        "--policy-pack",
        strictPackPath,
        "--receipt",
        strictReceiptPath,
      ]);

      expect(defaultResult.status, defaultResult.stderr).toBe(0);
      expect(strictResult.status, strictResult.stderr).toBe(0);
      expect(JSON.parse(defaultResult.stdout).riskLevel).toBe("LOW");
      expect(JSON.parse(strictResult.stdout).riskLevel).toBe("MEDIUM");

      const defaultReceipt = ChangeReceiptSchema.parse(JSON.parse(readFileSync(defaultReceiptPath, "utf8")));
      const strictReceipt = ChangeReceiptSchema.parse(JSON.parse(readFileSync(strictReceiptPath, "utf8")));
      expect(defaultReceipt.policyVersion).toBe(strictReceipt.policyVersion);
      expect(defaultReceipt.inputSha256).toBe(strictReceipt.inputSha256);
      expect(defaultReceipt.proposalSha256).toBe(strictReceipt.proposalSha256);
      expect(defaultReceipt.findings).not.toEqual(strictReceipt.findings);
      expect("policyPackSha256" in defaultReceipt).toBe(false);
      expect("policyPackSha256" in strictReceipt).toBe(false);
    },
  );
});
