import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

/**
 * Only files git actually tracks (or would stage) under EXAMPLE_ROOT — a
 * plain filesystem walk would also pick up a contributor's local, gitignored
 * `evidence/` output from running the harness against their own sandbox.
 */
function trackedFiles(root: string): string[] {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "."], {
    cwd: root,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((relative) => path.join(root, relative));
}

/** Extracts a single top-level `name() { ... }` function's source from the script. */
function extractFunction(script: string, name: string): string {
  const start = script.indexOf(`${name}() {`);
  expect(start, `missing function ${name}`).toBeGreaterThanOrEqual(0);
  const end = script.indexOf("\n}\n", start);
  expect(end, `unterminated function ${name}`).toBeGreaterThan(start);
  return script.slice(start, end + 2);
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const TERRAFORM_APPLY = /terraform\s+-chdir="\$INFRA"\s+apply\b/;
const TERRAFORM_DESTROY = /terraform\s+-chdir="\$INFRA"\s+destroy\b/;

/**
 * Removes `cat <<EOF ... EOF` heredoc bodies (the script's printed,
 * human-facing instructions) so executable-code assertions don't trip on
 * apply/destroy commands that appear only as text for a human to copy, never
 * as something this script runs.
 */
function stripHeredocs(script: string): string {
  return script.replace(/<<EOF\n[\s\S]*?\nEOF\n/g, "<<EOF\nEOF\n");
}

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

  it("assert_gate_matches_manifest actually catches a regressed policy, not just wrong syntax", () => {
    // Functional, not textual: run the harness's real function (extracted
    // verbatim, not reimplemented) against a synthetic gate result that
    // matches the manifest, then one where a single policy quietly
    // regressed, and confirm it accepts the first and rejects the second
    // with a message naming the mismatch.
    const script = readScript();
    const fn = extractFunction(script, "assert_gate_matches_manifest");
    expect(fn).toContain("evidence-manifest.json");

    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-m1-tier2-assert-"));
    temporaryDirectories.push(dir);

    const manifest = readManifest();
    const hostileCase = manifest.cases.find((c) => c.caseId === "m1-tier2-hostile");
    if (!hostileCase) throw new Error("hostile case must exist");
    writeFileSync(path.join(dir, "evidence-manifest.json"), JSON.stringify(manifest));

    const matchingGate = {
      decision: hostileCase.expected.decision,
      riskLevel: hostileCase.expected.riskLevel,
      findings: Object.entries(hostileCase.expected.findingStatuses).map(([policyId, status]) => ({
        policyId,
        status,
      })),
    };
    writeFileSync(path.join(dir, "matching-gate.json"), JSON.stringify(matchingGate));

    // UNTRUSTED_INSTRUCTION -- the prompt-injection detection this fixture's
    // hostile PR body exists to exercise -- quietly regresses from WARN to
    // PASS, with every other policy (including the overall BLOCK) unchanged.
    const regressedGate = {
      ...matchingGate,
      findings: matchingGate.findings.map((f) =>
        f.policyId === "UNTRUSTED_INSTRUCTION" ? { ...f, status: "PASS" } : f,
      ),
    };
    writeFileSync(path.join(dir, "regressed-gate.json"), JSON.stringify(regressedGate));

    const run = (gateFile: string) =>
      spawnSync("bash", ["-c", `MANIFEST="$1/evidence-manifest.json"; ${fn}\nassert_gate_matches_manifest "$1/${gateFile}" "m1-tier2-hostile"`, "bash", dir], {
        encoding: "utf8",
      });

    const matching = run("matching-gate.json");
    expect(matching.status, matching.stderr).toBe(0);

    const regressed = run("regressed-gate.json");
    expect(regressed.status).not.toBe(0);
    expect(regressed.stderr).toContain("UNTRUSTED_INSTRUCTION");
    expect(regressed.stderr).toContain("expected WARN, got PASS");
  });

  it("validates each receipt's release fields, not just the gate verdict", () => {
    // Matching decision/riskLevel/findings doesn't prove which release
    // produced them: an unintended ChangeSafe build (the exact failure
    // NPX_CWD isolation exists to prevent) could coincidentally reproduce
    // the same verdict while carrying a different appVersion or
    // policyVersion. assert_receipt_matches_manifest checks the receipt's
    // own release fields against the manifest instead.
    const script = readScript();
    expect(script).toContain("assert_receipt_matches_manifest() {");

    const benign = phaseSection(script, "benign");
    expect(benign).toContain('assert_receipt_matches_manifest "$EVIDENCE/benign.receipt.json"');
    const hostile = phaseSection(script, "hostile");
    expect(hostile).toContain('assert_receipt_matches_manifest "$EVIDENCE/hostile.receipt.json"');

    // Functional, not just textual: run the real function against a
    // synthetic receipt matching the manifest (accepts), then one with a
    // tampered appVersion (rejects, naming the mismatch). A signed receipt
    // nests its fields under .receipt; exercise that shape since it's the
    // one actually used on the hostile path.
    const fn = extractFunction(script, "assert_receipt_matches_manifest");
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-m1-tier2-receipt-"));
    temporaryDirectories.push(dir);

    const manifest = readManifest();
    writeFileSync(path.join(dir, "evidence-manifest.json"), JSON.stringify(manifest));

    const matchingReceipt = {
      receipt: { appVersion: manifest.release.appVersion, policyVersion: manifest.policyVersion },
    };
    writeFileSync(path.join(dir, "matching-receipt.json"), JSON.stringify(matchingReceipt));

    const tamperedReceipt = {
      receipt: { ...matchingReceipt.receipt, appVersion: "changesafe-cli-9.9.9" },
    };
    writeFileSync(path.join(dir, "tampered-receipt.json"), JSON.stringify(tamperedReceipt));

    const run = (receiptFile: string) =>
      spawnSync("bash", ["-c", `MANIFEST="$1/evidence-manifest.json"; ${fn}\nassert_receipt_matches_manifest "$1/${receiptFile}"`, "bash", dir], {
        encoding: "utf8",
      });

    const matching = run("matching-receipt.json");
    expect(matching.status, matching.stderr).toBe(0);

    const tampered = run("tampered-receipt.json");
    expect(tampered.status).not.toBe(0);
    expect(tampered.stderr).toContain("appVersion");
    expect(tampered.stderr).toContain(`expected ${manifest.release.appVersion}, got changesafe-cli-9.9.9`);
  });

  it("propagates hash-phase digest failures instead of writing a blank SHA256SUMS line", () => {
    // `echo "$(sha256 "$file")  $file" >> SHA256SUMS` has the same shape as
    // the state_sha256 bug: a failing sha256 (missing file, unreadable
    // file, broken digest utility) is swallowed inside the command
    // substitution, echo still succeeds, and the loop would continue
    // writing blank digest lines into the evidence anchor instead of
    // aborting.
    const script = readScript();
    const hashPhase = phaseSection(script, "hash");
    // Match only actual code, not the comment above it explaining the old
    // buggy shape (which necessarily quotes that shape as an example).
    const hashPhaseCode = hashPhase
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(hashPhaseCode).not.toMatch(/echo "\$\(sha256 "\$file"\)\s+\$file"/);
    expect(hashPhaseCode).toMatch(/digest="\$\(sha256 "\$file"\)"/);
    expect(hashPhaseCode).toContain('echo "$digest  $file"');
  });

  it("README's copy-pasteable apply command resolves the saved plan correctly under -chdir", () => {
    // `-chdir=infra` switches Terraform's working directory before it
    // resolves the plan-file argument, so a bare `evidence/benign.tfplan`
    // resolves as `infra/evidence/benign.tfplan` — one directory too deep,
    // since evidence/ is a sibling of infra/, not a child. The saved plan
    // must be reached with a path relative to infra/ (`../evidence/...`) or
    // an absolute one.
    const readme = readFileSync(path.join(EXAMPLE_ROOT, "README.md"), "utf8");
    expect(readme).not.toMatch(/-chdir=infra apply[^\n]*(?<!\.\.\/)evidence\/benign\.tfplan/);
    expect(readme).toContain("terraform -chdir=infra apply -input=false ../evidence/benign.tfplan");
  });

  it("describes the harness as read-only, not Terraform-free, and its no-op check as live", () => {
    // run-tier2.sh genuinely runs `terraform init/plan/show/state pull`
    // under the operator's real AWS credentials -- claiming it "never runs
    // Terraform" or "holds no cloud credentials" the way ChangeSafe itself
    // does would be false. What's actually true, and what the docs should
    // say, is narrower: it never applies, destroys, or otherwise mutates
    // infrastructure.
    const readme = readFileSync(path.join(EXAMPLE_ROOT, "README.md"), "utf8");
    expect(readme).not.toMatch(/run-tier2\.sh[^.]*never runs Terraform/);
    expect(readme).not.toMatch(/holds no cloud credentials[^.]*run-tier2\.sh/);
    expect(readme).toContain("ChangeSafe itself never runs Terraform");

    // The post-BLOCK check must be described as querying live AWS, not as a
    // -refresh=false comparison against the local cache — see the
    // corresponding hostile-phase assertion for why that distinction is the
    // actual safety property.
    expect(readme).not.toMatch(/-refresh=false -detailed-exitcode/);
  });

  it("validates the complete gate verdict against the manifest, not just the exit code", () => {
    // An exit code alone is not specific enough: a policy can regress (a
    // benign WARN nobody's exit-code check would catch; UNTRUSTED_INSTRUCTION
    // -- the prompt-injection detection the hostile PR body exists to
    // exercise -- silently passing while an unrelated policy still blocks)
    // without moving gate_code at all. assert_gate_matches_manifest compares
    // decision, riskLevel, and every policy's status against
    // evidence-manifest.json, the single source of truth for what each case
    // should say, rather than hand-picking a subset of policies to check.
    const script = readScript();
    expect(script).toContain('MANIFEST="$HERE/evidence-manifest.json"');
    expect(script).toContain("assert_gate_matches_manifest() {");

    const benign = phaseSection(script, "benign");
    expect(benign).toContain('assert_gate_matches_manifest "$EVIDENCE/benign-gate.json" "m1-tier2-benign"');
    const benignGateCheck = benign.indexOf('if [ "$gate_code" -ne 0 ]; then');
    const benignAssert = benign.indexOf("assert_gate_matches_manifest");
    const printedApply = benign.search(TERRAFORM_APPLY);
    expect(benignGateCheck).toBeGreaterThanOrEqual(0);
    expect(benignAssert).toBeGreaterThan(benignGateCheck);
    expect(printedApply).toBeGreaterThan(benignAssert);

    const hostile = phaseSection(script, "hostile");
    expect(hostile).toContain('assert_gate_matches_manifest "$EVIDENCE/hostile-gate.json" "m1-tier2-hostile"');
    // Must run after the gate's own exit-code check and before the plan
    // artifact is deleted, so a mismatch still has the artifact to inspect.
    const hostileGateCheck = hostile.indexOf('if [ "$gate_code" -ne 1 ]; then');
    const hostileAssert = hostile.indexOf("assert_gate_matches_manifest");
    const artifactDeleted = hostile.indexOf('rm -f "$EVIDENCE/hostile.tfplan"');
    expect(hostileGateCheck).toBeGreaterThanOrEqual(0);
    expect(hostileAssert).toBeGreaterThan(hostileGateCheck);
    expect(artifactDeleted).toBeGreaterThan(hostileAssert);
  });

  it("propagates state_sha256 failures instead of silently hashing a partial file", () => {
    // Every caller invokes state_sha256 through command substitution
    // (`x="$(state_sha256)"`), and bash does not propagate -e into a
    // command-substitution subshell by default (inherit_errexit is off
    // unless explicitly enabled, and this script can't assume a bash new
    // enough to have it). Without capturing and returning `terraform state
    // pull`'s exit status explicitly, a transient failure would be silently
    // swallowed: execution continues to hash an empty/partial file, and the
    // function still returns 0 because the trailing `rm -f` succeeds
    // regardless of what came before it.
    const script = readScript();
    const stateSha256Start = script.indexOf("state_sha256() {");
    const stateSha256End = script.indexOf("\n}\n", stateSha256Start);
    const stateSha256 = script.slice(stateSha256Start, stateSha256End);
    expect(stateSha256).toMatch(/status=\$\?/);
    expect(stateSha256).toMatch(/if \[ "\$status" -ne 0 \]; then/);
    expect(stateSha256).toMatch(/return "\$status"/);
  });

  it("commits the AWS provider lock file so a fresh checkout reproduces the recorded provider version", () => {
    // versions.tf constrains the provider to `>= 5.0`, which admits every
    // current or future 5.x/6.x/7.x release. Without a committed
    // .terraform.lock.hcl, a fresh checkout's `terraform init` would resolve
    // whatever the latest provider happens to be at that time -- not the
    // 6.60.0 the recorded evidence in M1_TIER2_EVIDENCE.md was actually
    // generated against -- and a future run could produce different plan
    // JSON or fail after a breaking provider release for reasons that have
    // nothing to do with ChangeSafe.
    const tracked = trackedFiles(EXAMPLE_ROOT).map((file) => path.relative(EXAMPLE_ROOT, file));
    expect(tracked).toContain(path.join("infra", ".terraform.lock.hcl"));

    // Only check actual ignore *patterns*, not prose -- the .gitignore's
    // own explanatory comment names this file deliberately.
    const gitignorePatterns = readFileSync(path.join(EXAMPLE_ROOT, ".gitignore"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(gitignorePatterns).not.toContain("infra/.terraform.lock.hcl");

    const lockFile = readFileSync(path.join(EXAMPLE_ROOT, "infra/.terraform.lock.hcl"), "utf8");
    expect(lockFile).toContain('provider "registry.terraform.io/hashicorp/aws"');
    expect(lockFile).toMatch(/version\s*=\s*"6\.60\.0"/);
  });

  it("never executes terraform apply or destroy — only ever prints them for a human", () => {
    const script = readScript();

    // Operator-only: the harness refuses CI outright.
    expect(script).toContain('if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then');

    // Safety invariant #1 (AGENTS.md) is unconditional: no terraform apply
    // or destroy execution path exists anywhere in this repository,
    // examples included. Stripping the heredoc bodies (the script's
    // printed, human-facing instructions) and then asserting neither
    // pattern survives proves this script never runs either itself.
    const executable = stripHeredocs(script);
    expect(executable).not.toMatch(TERRAFORM_APPLY);
    expect(executable).not.toMatch(TERRAFORM_DESTROY);

    // The hostile phase must not even print an apply command — a BLOCK has
    // nothing to hand off to a human.
    const hostile = phaseSection(script, "hostile");
    expect(hostile).not.toMatch(TERRAFORM_APPLY);
    expect(hostile).toContain('rm -f "$EVIDENCE/hostile.tfplan"');
    expect(hostile).toContain('if [ "$gate_code" -ne 1 ]; then');

    // The post-BLOCK "nothing landed" plan must query live AWS (default
    // refresh), not just the local state cache: a -refresh=false plan would
    // read 0 pending changes even if AWS had diverged from that cache
    // without Terraform's knowledge, proving nothing about the live estate.
    // (The script does mention -refresh=false in an explanatory comment on
    // why it's deliberately absent -- match the actual invocation line, not
    // the whole phase, so that comment doesn't trip this assertion.)
    const postPlanInvocation =
      hostile.match(/terraform -chdir="\$INFRA" plan[^\n]*-detailed-exitcode[^\n]*/)?.[0] ?? "";
    expect(postPlanInvocation).toMatch(/plan -input=false -detailed-exitcode/);
    expect(postPlanInvocation).not.toContain("-refresh=false");

    // The benign phase prints the apply command only after the exit-code
    // check, and only inside a heredoc (i.e. it is text for a human, not a
    // statement bash executes).
    const benign = phaseSection(script, "benign");
    const gateCheck = benign.indexOf('if [ "$gate_code" -ne 0 ]; then');
    const printedApply = benign.search(TERRAFORM_APPLY);
    expect(gateCheck).toBeGreaterThanOrEqual(0);
    expect(printedApply).toBeGreaterThan(gateCheck);
    expect(benign).toContain('apply -input=false "$EVIDENCE/benign.tfplan"');
    expect(stripHeredocs(benign)).not.toMatch(TERRAFORM_APPLY);

    // Both baseline and teardown likewise only ever print the mutating
    // command, never run it.
    const baseline = phaseSection(script, "baseline");
    expect(baseline).toMatch(TERRAFORM_APPLY);
    expect(stripHeredocs(baseline)).not.toMatch(TERRAFORM_APPLY);
    const teardown = phaseSection(script, "teardown");
    expect(teardown).toMatch(TERRAFORM_DESTROY);
    expect(stripHeredocs(teardown)).not.toMatch(TERRAFORM_DESTROY);

    // The gated apply is a saved plan, so nothing needs -auto-approve; its
    // presence anywhere would mean an unattended approval path.
    expect(script).not.toContain("-auto-approve");

    // The read-only record-* phases exist to capture evidence after a human
    // has applied by hand, and must themselves stay execution-free too.
    for (const phase of ["record-baseline", "record-benign"]) {
      const section = phaseSection(script, phase);
      expect(section).not.toMatch(TERRAFORM_APPLY);
      expect(section).not.toMatch(TERRAFORM_DESTROY);
    }

    // Every changesafe invocation resolves the pinned release against the
    // real registry. Matched as "npx --yes" specifically (not bare `npx`) so
    // this doesn't also pick up prose like "npx's bare-command resolution"
    // in the script's own comments.
    const npxInvocations = script.match(/npx --yes[^\n]*/g) ?? [];
    expect(npxInvocations.length).toBeGreaterThan(0);
    for (const invocation of npxInvocations) {
      expect(invocation, invocation).toContain("--registry=https://registry.npmjs.org");
      expect(invocation, invocation).toContain("--package=changesafe@0.5.0");
    }

    // npx's bare-command resolution prefers an enclosing project's
    // node_modules/.bin over --package, even when --package names an exact
    // version — this repo's own workspace build shadows the pinned release
    // otherwise. Every npx call must run from a scratch cwd with no
    // ancestor package.json (NPX_CWD, created via mktemp -d) rather than
    // $HERE or $INFRA, both of which are inside this repo.
    expect(script).toMatch(/NPX_CWD="\$\(mktemp -d\)"/);
    expect(script).toMatch(/\(cd "\$NPX_CWD" && npx --yes/);

    // Only one EXIT trap may exist: bash traps don't stack, so a second
    // `trap ... EXIT` anywhere would silently replace the first one instead
    // of composing with it, leaking whatever the first trap owned cleaning
    // up. All mktemp'd paths must instead register on the shared array the
    // single top-level trap iterates.
    const trapCalls = script.match(/^\s*trap /gm) ?? [];
    expect(trapCalls).toEqual(["trap "]);
    expect(script).toContain("CLEANUP_PATHS+=");

    const mode = statSync(path.join(EXAMPLE_ROOT, "run-tier2.sh")).mode;
    expect(mode & 0o111, "run-tier2.sh must be executable").not.toBe(0);
  });

  it("commits no run-time artifacts, credentials, or forbidden effect claims", () => {
    const files = trackedFiles(EXAMPLE_ROOT);
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
