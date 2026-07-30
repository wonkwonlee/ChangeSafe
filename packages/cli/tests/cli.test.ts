import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChangeReceiptSchema,
  evaluatePolicies,
  hashCanonical,
} from "@changesafe/core";
import { networkDomain } from "@changesafe/domain-network";
import { getScenario } from "@/scenarios";

import { main } from "../src/main";
import { CLI_APP_VERSION, CLI_PACKAGE_VERSION } from "../src/version";
import type { Console } from "../src/output";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SCENARIOS = path.join(REPO_ROOT, "scenarios");
const SAFE = path.join(SCENARIOS, "network", "scenario-a-failover");
const BLOCKED = path.join(SCENARIOS, "network", "scenario-b-route-leak");

/** Captures output so assertions read the CLI exactly as a user would. */
function createCapture(): Console & { stdout: string; stderr: string } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    out: (line) => lines.push(line),
    err: (line) => errors.push(line),
    color: false,
    get stdout() {
      return lines.join("\n");
    },
    get stderr() {
      return errors.join("\n");
    },
  };
}

const temporaryDirectories: string[] = [];
function temporaryDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "changesafe-cli-"));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("changesafe identity", () => {
  it("reports the package version through --version", async () => {
    const capture = createCapture();
    const code = await main(["--version"], capture);

    expect(code).toBe(0);
    expect(capture.stdout).toBe(`changesafe ${CLI_PACKAGE_VERSION}`);
  });
});

describe("changesafe gate", () => {
  it("exits 0 for a scenario with no blocking findings", async () => {
    const capture = createCapture();
    const code = await main(["gate", "--scenario", SAFE], capture);
    expect(code).toBe(0);
    expect(capture.stdout).toContain("7 PASS");
    expect(capture.stdout).toContain("risk: LOW");
    expect(capture.stdout).toContain("a human decision is still required");
    // A clean gate must never present itself as an approval.
    expect(capture.stdout).not.toMatch(/\bapproved\b/i);
  });

  it("exits 1 and explains why for a blocked scenario", async () => {
    const capture = createCapture();
    const code = await main(["gate", "--scenario", BLOCKED], capture);
    expect(code).toBe(1);
    expect(capture.stdout).toContain("MGMT_REACHABILITY");
    expect(capture.stdout).toContain("PROTECTED_RESOURCE");
    expect(capture.stdout).toContain("risk: CRITICAL");
    expect(capture.stdout).toContain("BLOCKED");
  });

  it("emits machine-readable findings with --format json", async () => {
    const capture = createCapture();
    const code = await main(["gate", "--scenario", BLOCKED, "--format", "json"], capture);
    expect(code).toBe(1);
    const payload = JSON.parse(capture.stdout);
    expect(payload.blocked).toBe(true);
    expect(payload.decision).toBe("blocked");
    expect(payload.riskLevel).toBe("CRITICAL");
    expect(payload.provenance).toBe("authored_red_team");
    expect(payload.findings).toHaveLength(7);
  });

  it("reproduces the app's findings exactly", async () => {
    // The exit-gate promise of the CLI: same engine, same verdicts, same
    // canonical hashes as the console — not a second implementation.
    const scenario = getScenario("scenario-b-route-leak");
    if (!scenario) throw new Error("scenario missing");
    const expected = evaluatePolicies(networkDomain, scenario.input as never, scenario.proposal);

    const capture = createCapture();
    await main(["gate", "--scenario", BLOCKED, "--format", "json"], capture);
    const payload = JSON.parse(capture.stdout);

    expect(payload.findings).toEqual(expected.findings);
    expect(payload.riskLevel).toBe(expected.riskLevel);
    expect(await hashCanonical(payload.findings)).toBe(await hashCanonical(expected.findings));
  });

  it("accepts explicit --input and --proposal paths", async () => {
    const capture = createCapture();
    const code = await main(
      [
        "gate",
        "--input",
        path.join(SAFE, "incident.json"),
        "--proposal",
        path.join(SAFE, "replay-fixture.json"),
        "--format",
        "json",
      ],
      capture,
    );
    expect(code).toBe(0);
    expect(JSON.parse(capture.stdout).blocked).toBe(false);
  });

  it("applies a policy pack's thresholds", async () => {
    // Scenario A touches one device and passes by default; a pack that warns
    // at one device must turn that same change into a warning.
    const dir = temporaryDir();
    const packPath = path.join(dir, "pack.json");
    writeFileSync(
      packPath,
      JSON.stringify({ name: "strict", blastRadius: { warnAt: 1, blockAbove: 2 } }),
    );

    const capture = createCapture();
    const code = await main(
      ["gate", "--scenario", SAFE, "--policy-pack", packPath, "--format", "json"],
      capture,
    );
    const payload = JSON.parse(capture.stdout);
    const blast = payload.findings.find((f: { policyId: string }) => f.policyId === "BLAST_RADIUS");
    expect(blast.status).toBe("WARN");
    expect(payload.riskLevel).toBe("MEDIUM");
    expect(code).toBe(0); // a warning is still not a block
  });

  it("rejects a policy pack that cannot make sense", async () => {
    const dir = temporaryDir();
    const packPath = path.join(dir, "pack.json");
    writeFileSync(packPath, JSON.stringify({ blastRadius: { warnAt: 9, blockAbove: 2 } }));
    const capture = createCapture();
    await expect(
      main(["gate", "--scenario", SAFE, "--policy-pack", packPath], capture),
    ).rejects.toThrow(/warnAt must not exceed blockAbove/);
  });

  it("writes a receipt that records a gate run, never an approval", async () => {
    const dir = temporaryDir();
    const receiptPath = path.join(dir, "receipt.json");

    const capture = createCapture();
    const code = await main(["gate", "--scenario", SAFE, "--receipt", receiptPath], capture);
    expect(code).toBe(0);

    const receipt = ChangeReceiptSchema.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
    expect(receipt.decision).toBe("gate_only");
    expect(receipt.simulation).toBeNull();
    expect(receipt.mode).toBe("offline");
    expect(receipt.riskLevel).toBe("LOW");
  });

  /**
   * Regenerating or re-verifying a published snapshot means running a build
   * that is no longer the one that produced it. The receipt has to come back
   * byte-identical, so the identity of the build has to be settable — for
   * that purpose only, alongside --receipt-id and --created-at.
   */
  it("stamps a supplied build identity, and its own by default", async () => {
    const dir = temporaryDir();
    const pinned = path.join(dir, "pinned.json");
    const ordinary = path.join(dir, "ordinary.json");

    await main(
      ["gate", "--scenario", SAFE, "--receipt", pinned, "--app-version", "changesafe-cli-0.0.9"],
      createCapture(),
    );
    await main(["gate", "--scenario", SAFE, "--receipt", ordinary], createCapture());

    expect(JSON.parse(readFileSync(pinned, "utf8")).appVersion).toBe("changesafe-cli-0.0.9");
    expect(JSON.parse(readFileSync(ordinary, "utf8")).appVersion).toBe(CLI_APP_VERSION);

    // Only the identity differs: an override must not change a verdict.
    const [a, b] = [pinned, ordinary].map(
      (file) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>,
    );
    expect(a?.findings).toEqual(b?.findings);
    expect(a?.riskLevel).toBe(b?.riskLevel);
  });

  it("records a blocked decision when the gate blocks", async () => {
    const dir = temporaryDir();
    const receiptPath = path.join(dir, "receipt.json");
    const capture = createCapture();
    const code = await main(["gate", "--scenario", BLOCKED, "--receipt", receiptPath], capture);
    expect(code).toBe(1);
    const receipt = ChangeReceiptSchema.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
    expect(receipt.decision).toBe("blocked");
  });

  it("refuses a proposal citing evidence the input does not contain", async () => {
    const dir = temporaryDir();
    const fixture = JSON.parse(readFileSync(path.join(SAFE, "replay-fixture.json"), "utf8"));
    fixture.proposal.diagnosis.evidenceIds.push("ev-invented-001");
    const proposalPath = path.join(dir, "proposal.json");
    writeFileSync(proposalPath, JSON.stringify(fixture));

    const capture = createCapture();
    await expect(
      main(
        ["gate", "--input", path.join(SAFE, "incident.json"), "--proposal", proposalPath],
        capture,
      ),
    ).rejects.toThrow(/ev-invented-001/);
  });

  it("reports unusable inputs rather than guessing", async () => {
    const capture = createCapture();
    await expect(main(["gate", "--scenario", "/nope/not/here"], capture)).rejects.toThrow(
      /cannot read/,
    );
    await expect(main(["gate", "--domain", "iam"], capture)).rejects.toThrow(
      /unknown domain/,
    );
    await expect(main(["gate", "--input", path.join(SAFE, "incident.json")], capture)).rejects.toThrow(
      /--proposal is required/,
    );
  });
});

describe("changesafe gate --domain terraform", () => {
  const PLANS = path.join(REPO_ROOT, "packages/domain-terraform/tests/fixtures");

  it("gates a plan without needing a separate proposal", async () => {
    const capture = createCapture();
    const code = await main(
      [
        "gate",
        "--domain",
        "terraform",
        "--input",
        path.join(PLANS, "safe-scale-up.tfplan.json"),
        "--format",
        "json",
      ],
      capture,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(capture.stdout);
    expect(payload.domain).toBe("terraform");
    // ROLLBACK_COMPLETE and VERIFICATION_REQUIRED do not apply to a plan.
    expect(payload.findings.map((f: { policyId: string }) => f.policyId)).toEqual([
      "PATCH_SCHEMA",
      "DESTRUCTIVE_OP",
      "PROTECTED_RESOURCE",
      "REVERSIBILITY",
      "BLAST_RADIUS",
      "UNTRUSTED_INSTRUCTION",
    ]);
  });

  it("blocks a destructive plan and flags injected pull request text", async () => {
    const capture = createCapture();
    const code = await main(
      [
        "gate",
        "--domain",
        "terraform",
        "--input",
        path.join(PLANS, "protected-and-injected.tfplan.json"),
        "--context",
        path.join(PLANS, "injected-pr-body.txt"),
        "--format",
        "json",
      ],
      capture,
    );
    expect(code).toBe(1);
    const payload = JSON.parse(capture.stdout);
    expect(payload.blocked).toBe(true);
    const byId = new Map(
      payload.findings.map((f: { policyId: string; status: string }) => [f.policyId, f.status]),
    );
    expect(byId.get("PROTECTED_RESOURCE")).toBe("BLOCK");
    expect(byId.get("UNTRUSTED_INSTRUCTION")).toBe("WARN");
  });

  it("writes a receipt whose source id survives an awkward file name", async () => {
    // Plan files are usually called things like prod.plan.tfplan.json, which
    // is not a valid identifier; the gate must normalize rather than fail.
    const dir = temporaryDir();
    const awkward = path.join(dir, "Prod.Plan v2.tfplan.json");
    writeFileSync(awkward, readFileSync(path.join(PLANS, "safe-scale-up.tfplan.json"), "utf8"));
    const receiptPath = path.join(dir, "receipt.json");

    const code = await main(
      ["gate", "--domain", "terraform", "--input", awkward, "--receipt", receiptPath],
      createCapture(),
    );
    expect(code).toBe(0);
    const receipt = ChangeReceiptSchema.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
    expect(receipt.sourceId).toBe("prod-plan-v2-tfplan");
    expect(receipt.decision).toBe("gate_only");
  });

  it("explains that the plan is the proposal", async () => {
    const capture = createCapture();
    await expect(
      main(
        [
          "gate",
          "--domain",
          "terraform",
          "--input",
          path.join(PLANS, "safe-scale-up.tfplan.json"),
          "--proposal",
          path.join(PLANS, "safe-scale-up.tfplan.json"),
        ],
        capture,
      ),
    ).rejects.toThrow(/derives its proposal from the plan/);
  });

  it("rejects a file that is not plan JSON", async () => {
    const dir = temporaryDir();
    const notAPlan = path.join(dir, "notes.json");
    writeFileSync(notAPlan, JSON.stringify({ resource_changes: "definitely not an array" }));
    await expect(
      main(["gate", "--domain", "terraform", "--input", notAPlan], createCapture()),
    ).rejects.toThrow(/terraform show -json/);
  });
});

describe("changesafe verify", () => {
  it("confirms a receipt it just produced, including its input and proposal", async () => {
    const dir = temporaryDir();
    const receiptPath = path.join(dir, "receipt.json");
    await main(["gate", "--scenario", SAFE, "--receipt", receiptPath], createCapture());

    const capture = createCapture();
    const code = await main(
      [
        "verify",
        receiptPath,
        "--input",
        path.join(SAFE, "incident.json"),
        "--proposal",
        path.join(SAFE, "replay-fixture.json"),
        "--format",
        "json",
      ],
      capture,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(capture.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.checks).toHaveLength(3);
  });

  it("detects an altered receipt", async () => {
    const dir = temporaryDir();
    const receiptPath = path.join(dir, "receipt.json");
    await main(["gate", "--scenario", SAFE, "--receipt", receiptPath], createCapture());

    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    receipt.riskLevel = "CRITICAL";
    writeFileSync(receiptPath, JSON.stringify(receipt));

    const capture = createCapture();
    const code = await main(["verify", receiptPath, "--format", "json"], capture);
    expect(code).toBe(1);
    expect(JSON.parse(capture.stdout).ok).toBe(false);
  });

  it("detects a receipt that does not describe the supplied input", async () => {
    const dir = temporaryDir();
    const receiptPath = path.join(dir, "receipt.json");
    await main(["gate", "--scenario", SAFE, "--receipt", receiptPath], createCapture());

    const capture = createCapture();
    const code = await main(
      ["verify", receiptPath, "--input", path.join(BLOCKED, "incident.json"), "--format", "json"],
      capture,
    );
    expect(code).toBe(1);
    const inputCheck = JSON.parse(capture.stdout).checks.find(
      (check: { name: string }) => check.name === "input hash",
    );
    expect(inputCheck.ok).toBe(false);
  });
});

describe("changesafe scenario", () => {
  it("checks the bundled scenarios against their expectations", async () => {
    const capture = createCapture();
    const code = await main(
      ["scenario", "check", path.join(SCENARIOS, "network"), "--format", "json"],
      capture,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(capture.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.scenarios.length).toBeGreaterThanOrEqual(6);
  });

  it("fails a scenario whose expectations are wrong", async () => {
    const dir = temporaryDir();
    const scenarioDir = path.join(dir, "scenario-wrong");
    await main(["scenario", "init", "scenario-wrong", "--dir", dir], createCapture());

    const expectationsPath = path.join(scenarioDir, "expectations.json");
    const expectations = JSON.parse(readFileSync(expectationsPath, "utf8"));
    expectations.policies.MGMT_REACHABILITY = "BLOCK";
    expectations.riskLevel = "CRITICAL";
    expectations.approvable = false;
    expectations.simulation = null;
    writeFileSync(expectationsPath, JSON.stringify(expectations));

    const capture = createCapture();
    const code = await main(["scenario", "check", dir, "--format", "json"], capture);
    expect(code).toBe(1);
    const [result] = JSON.parse(capture.stdout).scenarios;
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("MGMT_REACHABILITY");
  });

  it("scaffolds a scenario that passes its own check", async () => {
    const dir = temporaryDir();
    const capture = createCapture();
    const code = await main(["scenario", "init", "scenario-fresh", "--dir", dir], capture);
    expect(code).toBe(0);
    for (const file of ["incident.json", "replay-fixture.json", "expectations.json"]) {
      expect(existsSync(path.join(dir, "scenario-fresh", file))).toBe(true);
    }

    // The template must be honest out of the box: what it claims is what the
    // gate produces, or contributors start from a lie.
    const check = createCapture();
    expect(await main(["scenario", "check", dir, "--format", "json"], check)).toBe(0);
  });

  it("refuses a name that is not a valid scenario id", async () => {
    const dir = temporaryDir();
    await expect(
      main(["scenario", "init", "Not Valid", "--dir", dir], createCapture()),
    ).rejects.toThrow(/kebab-case/);
  });
});

describe("changesafe usage", () => {
  it("prints help and exits 2 when given no command", async () => {
    const capture = createCapture();
    expect(await main([], capture)).toBe(2);
    expect(capture.stdout).toContain("changesafe gate");
    expect(capture.stdout).toContain("No command approves a change");
  });

  it("rejects unknown commands and formats", async () => {
    const capture = createCapture();
    await expect(main(["frobnicate"], capture)).rejects.toThrow(/unknown command/);
    await expect(main(["gate", "--format", "yaml"], capture)).rejects.toThrow(/--format/);
  });
});

describe("analyze — the only command that calls a model", () => {
  const savedEnv = {
    CHANGESAFE_PROVIDER: process.env.CHANGESAFE_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };

  beforeEach(() => {
    for (const key of Object.keys(savedEnv)) delete process.env[key];
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reproduces a signed envelope when audited metadata is fixed", async () => {
    const dir = temporaryDir();
    const keyOut = path.join(dir, "analyze-key");
    await main(["keygen", "--out", keyOut], createCapture());

    const fixture = JSON.parse(readFileSync(path.join(SAFE, "replay-fixture.json"), "utf8"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        model: "llama3.1",
        done: true,
        message: { content: JSON.stringify(fixture.proposal) },
      })) as typeof globalThis.fetch;

    try {
      const args = [
        "analyze",
        "--scenario",
        SAFE,
        "--provider",
        "ollama",
        "--sign-key",
        `${keyOut}.pem`,
        "--receipt-id",
        "rcpt-v0-1-0-analyze",
        "--created-at",
        "2026-07-26T12:00:00.000Z",
      ];
      const first = path.join(dir, "first.json");
      const second = path.join(dir, "second.json");

      await main([...args, "--receipt", first], createCapture());
      await main([...args, "--receipt", second], createCapture());

      expect(readFileSync(first, "utf8")).toBe(readFileSync(second, "utf8"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps receipt snapshot time separate from capture provenance time", async () => {
    const dir = temporaryDir();
    const keyOut = path.join(dir, "provenance-key");
    await main(["keygen", "--out", keyOut], createCapture());

    const fixture = JSON.parse(readFileSync(path.join(SAFE, "replay-fixture.json"), "utf8"));
    const originalFetch = globalThis.fetch;
    const receiptTime = "2026-07-26T12:00:00.000Z";
    const captureTime = "2026-07-26T13:00:00.000Z";
    globalThis.fetch = (async () =>
      Response.json({
        model: "llama3.1",
        done: true,
        message: { content: JSON.stringify(fixture.proposal) },
      })) as typeof globalThis.fetch;
    vi.useFakeTimers();
    vi.setSystemTime(captureTime);

    try {
      const receiptPath = path.join(dir, "receipt.json");
      const capturePath = path.join(dir, "capture.json");
      await main(
        [
          "analyze",
          "--scenario",
          SAFE,
          "--provider",
          "ollama",
          "--sign-key",
          `${keyOut}.pem`,
          "--receipt-id",
          "rcpt-v0-1-0-provenance",
          "--created-at",
          receiptTime,
          "--receipt",
          receiptPath,
          "--capture",
          capturePath,
        ],
        createCapture(),
      );

      const signed = JSON.parse(readFileSync(receiptPath, "utf8"));
      const captured = JSON.parse(readFileSync(capturePath, "utf8"));
      expect(signed.receipt.createdAtUtc).toBe(receiptTime);
      expect(signed.signature.signedAtUtc).toBe(receiptTime);
      expect(captured.capturedAtUtc).toBe(captureTime);
      expect(captured.notes).toContain(captureTime);
      expect(captured.notes).not.toContain(receiptTime);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = originalFetch;
    }
  });

  it("stops with a usage error rather than guessing a provider", async () => {
    const capture = createCapture();
    // Silently picking a different model than the operator expected would be
    // worse than refusing to run.
    await expect(main(["analyze", "--scenario", SAFE], capture)).rejects.toThrow(
      /no model provider is configured/,
    );
  });

  it("refuses a provider whose credential is missing, naming the variable", async () => {
    const capture = createCapture();
    await expect(
      main(["analyze", "--scenario", SAFE, "--provider", "anthropic"], capture),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("rejects an unknown provider", async () => {
    const capture = createCapture();
    await expect(
      main(["analyze", "--scenario", SAFE, "--provider", "gpt4all"], capture),
    ).rejects.toThrow(/Unknown provider/);
  });

  it("explains why the terraform domain has nothing for a model to propose", async () => {
    const capture = createCapture();
    await expect(
      main(["analyze", "--domain", "terraform", "--input", "plan.json"], capture),
    ).rejects.toThrow(/derives its proposal from the plan/);
  });

  it("makes eval demand an explicit provider because it spends credit", async () => {
    const capture = createCapture();
    await expect(main(["eval"], capture)).rejects.toThrow(/spends API credit/);
  });
});

describe("signed receipts", () => {
  /** Generate a key pair in a temp dir and return its paths. */
  async function keys(dir: string, name = "key") {
    const capture = createCapture();
    const out = path.join(dir, name);
    const code = await main(["keygen", "--out", out, "--format", "json"], capture);
    expect(code).toBe(0);
    return {
      privatePath: `${out}.pem`,
      publicPath: `${out}.pub.pem`,
      publicKeyId: JSON.parse(capture.stdout).publicKeyId as string,
    };
  }

  async function signedReceipt(dir: string, keyPath: string, file = "receipt.json") {
    const receiptPath = path.join(dir, file);
    await main(
      ["gate", "--scenario", SAFE, "--receipt", receiptPath, "--sign-key", keyPath],
      createCapture(),
    );
    return receiptPath;
  }

  it("reproduces a signed envelope when receipt identity and time are fixed", async () => {
    const dir = temporaryDir();
    const key = await keys(dir);
    const args = [
      "gate",
      "--scenario",
      SAFE,
      "--sign-key",
      key.privatePath,
      "--receipt-id",
      "rcpt-v0-1-0-demo",
      "--created-at",
      "2026-07-26T12:00:00.000Z",
    ];
    const first = path.join(dir, "first.json");
    const second = path.join(dir, "second.json");

    await main([...args, "--receipt", first], createCapture());
    await main([...args, "--receipt", second], createCapture());

    expect(readFileSync(first, "utf8")).toBe(readFileSync(second, "utf8"));
  });

  it("writes an envelope whose receipt is unchanged by signing", async () => {
    const dir = temporaryDir();
    const key = await keys(dir);

    const plainPath = path.join(dir, "plain.json");
    await main(["gate", "--scenario", SAFE, "--receipt", plainPath], createCapture());
    const signedPath = await signedReceipt(dir, key.privatePath);

    const plain = JSON.parse(readFileSync(plainPath, "utf8"));
    const signed = JSON.parse(readFileSync(signedPath, "utf8"));

    expect(Object.keys(signed).sort()).toEqual(["receipt", "signature"]);
    expect(signed.signature.publicKeyId).toBe(key.publicKeyId);
    // Signing is additive: everything except the run-specific id and
    // timestamp is identical to the unsigned receipt.
    const strip = (r: Record<string, unknown>) => ({ ...r, receiptId: "", createdAtUtc: "", receiptSha256: "" });
    expect(strip(signed.receipt)).toEqual(strip(plain));
  });

  it("verifies against the matching public key", async () => {
    const dir = temporaryDir();
    const key = await keys(dir);
    const receiptPath = await signedReceipt(dir, key.privatePath);

    const capture = createCapture();
    const code = await main(
      ["verify", receiptPath, "--public-key", key.publicPath, "--format", "json"],
      capture,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(capture.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.signature.verdict).toBe("valid");
  });

  it("catches tampering that was re-hashed to look intact", async () => {
    // The point of signing. An attacker who edits a receipt can recompute
    // receiptSha256 — the hash check then passes and only the signature,
    // which they cannot forge without the private key, still fails.
    const dir = temporaryDir();
    const key = await keys(dir);
    const receiptPath = await signedReceipt(dir, key.privatePath);

    const envelope = JSON.parse(readFileSync(receiptPath, "utf8"));
    envelope.receipt.riskLevel = "CRITICAL";
    // Recompute the self-hash the way the real code does: over the receipt
    // content with the hash field removed.
    const rest = { ...envelope.receipt };
    delete rest.receiptSha256;
    envelope.receipt.receiptSha256 = await hashCanonical(rest);
    writeFileSync(receiptPath, JSON.stringify(envelope));

    const capture = createCapture();
    const code = await main(
      ["verify", receiptPath, "--public-key", key.publicPath, "--format", "json"],
      capture,
    );
    const payload = JSON.parse(capture.stdout);

    expect(payload.checks.find((c: { name: string }) => c.name === "receipt hash").ok).toBe(true);
    expect(payload.signature.verdict).toBe("invalid");
    expect(payload.ok).toBe(false);
    expect(code).toBe(1);
  });

  it("reports another party's valid signature as a key mismatch", async () => {
    const dir = temporaryDir();
    const mine = await keys(dir, "mine");
    const theirs = await keys(dir, "theirs");
    const receiptPath = await signedReceipt(dir, theirs.privatePath);

    const capture = createCapture();
    const code = await main(
      ["verify", receiptPath, "--public-key", mine.publicPath, "--format", "json"],
      capture,
    );
    expect(code).toBe(1);
    expect(JSON.parse(capture.stdout).signature.verdict).toBe("key_mismatch");
  });

  it("refuses to pass a signed receipt it was given no key to check", async () => {
    const dir = temporaryDir();
    const key = await keys(dir);
    const receiptPath = await signedReceipt(dir, key.privatePath);

    // Exit 2, not 0: an unchecked signature is a missing verdict about
    // authorship, and must never read as a clean verification.
    await expect(main(["verify", receiptPath], createCapture())).rejects.toThrow(
      /no key was supplied to check it/,
    );
  });

  it("reports an explicitly skipped signature as unknown, never as passing", async () => {
    const dir = temporaryDir();
    const key = await keys(dir);
    const receiptPath = await signedReceipt(dir, key.privatePath);

    const capture = createCapture();
    const code = await main(
      ["verify", receiptPath, "--skip-signature", "--format", "json"],
      capture,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(capture.stdout);
    expect(payload.signature.verdict).toBe("unverified");
    // The check itself is not marked ok — the run passes on integrity alone.
    expect(payload.checks.find((c: { name: string }) => c.name === "signature").ok).toBe(false);
  });

  it("rejects a key supplied for a receipt that carries no signature", async () => {
    const dir = temporaryDir();
    const key = await keys(dir);
    const plainPath = path.join(dir, "plain.json");
    await main(["gate", "--scenario", SAFE, "--receipt", plainPath], createCapture());

    await expect(
      main(["verify", plainPath, "--public-key", key.publicPath], createCapture()),
    ).rejects.toThrow(/carries no signature/);
  });

  it("still verifies unsigned receipts exactly as before", async () => {
    const dir = temporaryDir();
    const plainPath = path.join(dir, "plain.json");
    await main(["gate", "--scenario", SAFE, "--receipt", plainPath], createCapture());

    const capture = createCapture();
    const code = await main(["verify", plainPath, "--format", "json"], capture);
    expect(code).toBe(0);
    expect(JSON.parse(capture.stdout).signature).toBeNull();
  });

  it("will not silently replace a key that existing receipts depend on", async () => {
    const dir = temporaryDir();
    const key = await keys(dir);
    await expect(
      main(["keygen", "--out", key.privatePath.replace(/\.pem$/, "")], createCapture()),
    ).rejects.toThrow(/already exists/);
  });

  it("writes the private key owner-readable only", async () => {
    const dir = temporaryDir();
    const key = await keys(dir);
    // A signing key other local accounts can read is not a signing key.
    expect(statSync(key.privatePath).mode & 0o777).toBe(0o600);
  });
});

describe("changesafe ledger", () => {
  async function ledgerWith(dir: string, scenarios: string[]) {
    const db = path.join(dir, "ledger.db");
    for (const [index, scenario] of scenarios.entries()) {
      const receiptPath = path.join(dir, `r${index}.json`);
      await main(["gate", "--scenario", scenario, "--receipt", receiptPath], createCapture());
      await main(["ledger", "append", receiptPath, "--db", db], createCapture());
    }
    return db;
  }

  it("records decisions and lists them newest first", async () => {
    const dir = temporaryDir();
    const db = await ledgerWith(dir, [SAFE, BLOCKED]);

    const capture = createCapture();
    const code = await main(["ledger", "list", "--db", db, "--format", "json"], capture);
    expect(code).toBe(0);
    const entries = JSON.parse(capture.stdout);
    expect(entries).toHaveLength(2);
    expect(entries[0].seq).toBe(2);
    expect(entries[0].decision).toBe("blocked");
    expect(entries[1].decision).toBe("gate_only");
  });

  it("verifies an intact chain and reports a head to witness", async () => {
    const dir = temporaryDir();
    const db = await ledgerWith(dir, [SAFE, BLOCKED, SAFE]);

    const capture = createCapture();
    const code = await main(["ledger", "verify", "--db", db, "--format", "json"], capture);
    expect(code).toBe(0);
    const verdict = JSON.parse(capture.stdout);
    expect(verdict.ok).toBe(true);
    expect(verdict.entries).toBe(3);
    expect(verdict.headChainSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("exits 1 when a decision was removed from the file", async () => {
    const dir = temporaryDir();
    const db = await ledgerWith(dir, [SAFE, BLOCKED, SAFE]);

    // The scenario the ledger exists for: someone with file access deletes
    // the inconvenient BLOCKED decision. The remaining rows still look
    // perfect, and listing them shows nothing wrong.
    const raw = new DatabaseSync(db);
    raw.exec("DROP TRIGGER receipts_no_delete");
    raw.exec("DELETE FROM receipts WHERE decision = 'blocked'");
    raw.close();

    const listing = createCapture();
    await main(["ledger", "list", "--db", db, "--format", "json"], listing);
    expect(JSON.parse(listing.stdout)).toHaveLength(2);

    const capture = createCapture();
    const code = await main(["ledger", "verify", "--db", db, "--format", "json"], capture);
    expect(code).toBe(1);
    expect(JSON.parse(capture.stdout).ok).toBe(false);
  });

  it("records which key signed a receipt, and that it was unsigned otherwise", async () => {
    const dir = temporaryDir();
    const db = path.join(dir, "ledger.db");
    const keyOut = path.join(dir, "key");
    const keygen = createCapture();
    await main(["keygen", "--out", keyOut, "--format", "json"], keygen);
    const publicKeyId = JSON.parse(keygen.stdout).publicKeyId;

    const signedReceipt = path.join(dir, "signed.json");
    await main(
      ["gate", "--scenario", SAFE, "--receipt", signedReceipt, "--sign-key", `${keyOut}.pem`],
      createCapture(),
    );
    const plainReceipt = path.join(dir, "plain.json");
    await main(["gate", "--scenario", BLOCKED, "--receipt", plainReceipt], createCapture());

    await main(["ledger", "append", signedReceipt, "--db", db], createCapture());
    await main(["ledger", "append", plainReceipt, "--db", db], createCapture());

    const capture = createCapture();
    await main(["ledger", "list", "--db", db, "--format", "json"], capture);
    const entries = JSON.parse(capture.stdout);
    expect(entries.find((e: { seq: number }) => e.seq === 1).signatureKeyId).toBe(publicKeyId);
    expect(entries.find((e: { seq: number }) => e.seq === 2).signatureKeyId).toBeNull();
  });

  it("refuses to record the same receipt twice", async () => {
    const dir = temporaryDir();
    const db = path.join(dir, "ledger.db");
    const receiptPath = path.join(dir, "r.json");
    await main(["gate", "--scenario", SAFE, "--receipt", receiptPath], createCapture());
    await main(["ledger", "append", receiptPath, "--db", db], createCapture());

    await expect(
      main(["ledger", "append", receiptPath, "--db", db], createCapture()),
    ).rejects.toThrow(/already in the ledger/);
  });

  it("rejects an unknown ledger subcommand", async () => {
    await expect(main(["ledger", "purge"], createCapture())).rejects.toThrow(
      /unknown ledger subcommand/,
    );
  });
});

describe("the built binary", () => {
  const built = path.join(REPO_ROOT, "packages/cli/dist/changesafe.js");

  it.runIf(existsSync(built))("runs under plain node with no bundler", () => {
    // Proves the shipped artifact works outside the workspace: no aliases,
    // no transpiler, no node_modules resolution of workspace packages.
    const stdout = execFileSync(process.execPath, [built, "gate", "--scenario", SAFE, "--format", "json"], {
      encoding: "utf8",
      cwd: tmpdir(),
    });
    const payload = JSON.parse(stdout);
    expect(payload.blocked).toBe(false);
    expect(payload.findings).toHaveLength(7);
  });

  /**
   * npm installs a `bin` as a symlink, and Node resolves a symlinked module to
   * its real path. Anything that decides whether to run by comparing
   * `import.meta.url` with `process.argv[1]` therefore does nothing when
   * invoked as `changesafe` or through `npx` — and exits 0 having evaluated
   * nothing, which is the code that means "nothing blocking".
   *
   * So the binary is exercised the way a published package is reached: through
   * a symlink, on a change that must be refused.
   */
  it.runIf(existsSync(built))("gates when reached through a bin symlink", () => {
    const directory = temporaryDir();
    const link = path.join(directory, "changesafe");
    symlinkSync(built, link);

    const result = spawnSync(
      link,
      [
        "gate",
        "--domain",
        "terraform",
        "--input",
        path.join(REPO_ROOT, "packages/domain-terraform/tests/fixtures/destroys-database.tfplan.json"),
        "--format",
        "json",
      ],
      { encoding: "utf8", cwd: directory },
    );

    // Silence and exit 0 is the failure this guards against, so assert the
    // verdict arrived, not merely that nothing crashed.
    expect(result.stdout, "the symlinked binary produced no output").not.toBe("");
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout) as { blocked: boolean; riskLevel: string };
    expect(payload.blocked).toBe(true);
    expect(payload.riskLevel).toBe("CRITICAL");
  });
});
