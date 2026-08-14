import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const EXAMPLE_ROOT = path.join(REPO_ROOT, "examples/m1-tier2-aws-sandbox");

interface ManifestCase {
  caseId: string;
  proposal: string;
  plan: { path: string; captured: "at-run-time"; sha256: null };
  context: { path: string; sha256: string } | null;
  expected: {
    exitCode: number;
    blocked: boolean;
    decision: "gate_only" | "blocked";
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    findingStatuses: Record<string, "PASS" | "WARN" | "BLOCK">;
    applyReached: boolean;
  };
}

interface Manifest {
  schema: "changesafe-m1-tier2-aws-sandbox/v1";
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

function readManifest(): Manifest {
  return JSON.parse(
    readFileSync(path.join(EXAMPLE_ROOT, "evidence-manifest.json"), "utf8"),
  ) as Manifest;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readScript(): string {
  return readFileSync(path.join(EXAMPLE_ROOT, "run-tier2.sh"), "utf8");
}

/** The section of the harness between one `# === phase: x ===` marker and the next. */
function phaseSection(script: string, phase: string): string {
  const marker = `# === phase: ${phase} ===`;
  const start = script.indexOf(marker);
  expect(start, `missing marker for phase ${phase}`).toBeGreaterThanOrEqual(0);
  const next = script.indexOf("# === phase: ", start + marker.length);
  return next === -1 ? script.slice(start) : script.slice(start, next);
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

const TERRAFORM_APPLY = /terraform\s+-chdir="\$INFRA"\s+apply\b/;

describe("M1 Tier 2 AWS sandbox template", () => {
  it("pins the same release as Tier 1 and declares both cases with honest verdict expectations", () => {
    const manifest = readManifest();

    expect(manifest.schema).toBe("changesafe-m1-tier2-aws-sandbox/v1");
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
      "m1-tier2-benign",
      "m1-tier2-hostile",
    ]);

    const [benign, hostile] = manifest.cases;
    if (!benign || !hostile) throw new Error("both manifest cases must exist");

    // Plans are captured live from the sandbox, so the manifest must not
    // pretend to know their hashes ahead of time.
    for (const entry of manifest.cases) {
      expect(entry.plan.captured).toBe("at-run-time");
      expect(entry.plan.sha256).toBeNull();
    }

    expect(benign.expected).toMatchObject({
      exitCode: 0,
      blocked: false,
      decision: "gate_only",
      riskLevel: "LOW",
      applyReached: true,
    });
    expect(Object.values(benign.expected.findingStatuses)).not.toContain("BLOCK");

    expect(hostile.expected).toMatchObject({
      exitCode: 1,
      blocked: true,
      decision: "blocked",
      riskLevel: "CRITICAL",
      applyReached: false,
    });
    expect(hostile.expected.findingStatuses.DESTRUCTIVE_OP).toBe("BLOCK");
    expect(hostile.expected.findingStatuses.PROTECTED_RESOURCE).toBe("BLOCK");
    expect(hostile.expected.findingStatuses.UNTRUSTED_INSTRUCTION).toBe("WARN");

    expect(hostile.context).not.toBeNull();
    if (hostile.context) {
      expect(sha256(path.join(EXAMPLE_ROOT, hostile.context.path))).toBe(
        hostile.context.sha256,
      );
    }
  });

  it("keeps apply reachable only through the gate's exit code", () => {
    const script = readScript();

    // Operator-only: the harness refuses CI outright.
    expect(script).toContain('if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then');

    // The hostile phase must contain no Terraform apply at all — a BLOCK has
    // nothing to fall through to.
    const hostile = phaseSection(script, "hostile");
    expect(hostile).not.toMatch(TERRAFORM_APPLY);
    expect(hostile).toContain('rm -f "$EVIDENCE/hostile.tfplan"');
    expect(hostile).toContain('if [ "$gate_code" -ne 1 ]; then');

    // The benign phase applies only the saved plan the gate read, and only
    // after the exit-code check.
    const benign = phaseSection(script, "benign");
    const gateCheck = benign.indexOf('if [ "$gate_code" -ne 0 ]; then');
    const applyCall = benign.search(TERRAFORM_APPLY);
    expect(gateCheck).toBeGreaterThanOrEqual(0);
    expect(applyCall).toBeGreaterThan(gateCheck);
    expect(benign).toContain('apply -input=false "$EVIDENCE/benign.tfplan"');

    // The gated apply is a saved plan, so nothing needs -auto-approve; its
    // presence anywhere would mean an unattended approval path.
    expect(script).not.toContain("-auto-approve");

    // Every changesafe invocation resolves the pinned release against the
    // real registry.
    const npxInvocations = script.match(/npx[^\n]*/g) ?? [];
    expect(npxInvocations.length).toBeGreaterThan(0);
    for (const invocation of npxInvocations) {
      expect(invocation, invocation).toContain("--registry=https://registry.npmjs.org");
      expect(invocation, invocation).toContain("--package=changesafe@0.5.0");
    }

    const mode = statSync(path.join(EXAMPLE_ROOT, "run-tier2.sh")).mode;
    expect(mode & 0o111, "run-tier2.sh must be executable").not.toBe(0);
  });

  it("commits no run-time artifacts, credentials, or forbidden effect claims", () => {
    const files = walkFiles(EXAMPLE_ROOT);
    const relativeFiles = files.map((file) => path.relative(EXAMPLE_ROOT, file));

    for (const relative of relativeFiles) {
      expect(relative).not.toMatch(/^evidence\//);
      expect(relative).not.toMatch(/\.tfstate/);
      expect(relative).not.toMatch(/\.tfplan$/);
      expect(relative).not.toBe(path.join("infra", "terraform.tfvars"));
    }

    const gitignore = readFileSync(path.join(EXAMPLE_ROOT, ".gitignore"), "utf8");
    for (const pattern of ["evidence/", "infra/terraform.tfstate", "infra/terraform.tfvars"]) {
      expect(gitignore).toContain(pattern);
    }

    // Claim discipline (docs/STRATEGY.agent.md §4): a receipt or gate verdict
    // never attests an execution outcome, so the template must not say so.
    const forbiddenPhrasings = [
      /guarantees the actual effect/i,
      /proves the change was applied/i,
      /cryptographically guarantees the outcome/i,
      /ensures the cluster reached/i,
      /proven safe/i,
      /verified secure/i,
    ];
    for (const file of files) {
      const relative = path.relative(REPO_ROOT, file);
      const source = readFileSync(file, "utf8");
      for (const phrase of forbiddenPhrasings) {
        expect(source, `${relative} must not claim: ${phrase}`).not.toMatch(phrase);
      }
      expect(source, relative).not.toMatch(/AuthorizationGrant/);
      expect(source, relative).not.toMatch(
        /\bAWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\b/,
      );
    }
  });
});
