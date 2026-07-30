import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * What an installer gets, rather than what the workspace sees.
 *
 * Inside the repository every `@changesafe/*` import is aliased straight to
 * TypeScript source, so nothing here is exercised by an ordinary test run:
 * not the compiled output, not the declarations, not the `exports` map, not
 * whether the dependencies a consumer must resolve are actually declared.
 * Packaging the CLI turned up two defects of exactly that shape — a package
 * whose dependencies could not resolve, and a binary that exited 0 having
 * evaluated nothing. Cloning would never have shown either.
 *
 * So this packs the real tarballs, installs them into a project that has no
 * relationship to this repository, and gates a change through them.
 */

const root = path.resolve(import.meta.dirname, "../..");
const PACKAGES = [
  { name: "@changesafe/core", directory: "packages/core" },
  { name: "@changesafe/domain-network", directory: "packages/domain-network" },
  { name: "@changesafe/domain-terraform", directory: "packages/domain-terraform" },
  { name: "@changesafe/domain-kubernetes", directory: "packages/domain-kubernetes" },
] as const;

const built = PACKAGES.every((entry) => existsSync(path.join(root, entry.directory, "dist")));

const temporaryDirectories: string[] = [];
function temporaryDir(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe.runIf(built)("the published packages", () => {
  // Packing and installing is slow next to a unit test, and it is the only
  // thing here that tests the artifact rather than the source.
  const consumer = temporaryDir("changesafe-consumer-");
  const tarballs = temporaryDir("changesafe-tarballs-");

  const npm = (args: string[], cwd: string): string =>
    execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const version = JSON.parse(
    readFileSync(path.join(root, "packages/core/package.json"), "utf8"),
  ).version as string;

  /**
   * The tarballs are unpacked into the consumer's node_modules directly
   * rather than installed with `npm install`.
   *
   * `npm install <tarball>` still resolves the dependencies those tarballs
   * declare, which means reaching the registry for zod — and a test suite that
   * quietly needs the network is a suite that fails for reasons unrelated to
   * the code. What matters here is whether the packed artifact resolves and
   * runs: its `exports` map, its declarations, its compiled JavaScript. Node's
   * resolver answers that from node_modules regardless of who put the files
   * there, and zod comes from the workspace that already has it.
   */
  function installPackedArtifacts(): void {
    const modules = path.join(consumer, "node_modules");
    for (const entry of PACKAGES) {
      const tarball = path.join(
        tarballs,
        `${entry.name.replace("@", "").replace("/", "-")}-${version}.tgz`,
      );
      npm(["pack", "-w", entry.name, "--pack-destination", tarballs], root);
      const target = path.join(modules, entry.name);
      mkdirSync(target, { recursive: true });
      execFileSync("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"]);
    }
    cpSync(path.join(root, "node_modules/zod"), path.join(modules, "zod"), {
      recursive: true,
    });
    cpSync(path.join(root, "node_modules/yaml"), path.join(modules, "yaml"), {
      recursive: true,
    });
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({ name: "changesafe-consumer", private: true, type: "module" }, null, 2),
    );
  }

  it("packs, installs, and gates a change end to end", () => {
    installPackedArtifacts();

    const script = path.join(consumer, "gate.mjs");
    writeFileSync(
      script,
      `
      import { readFileSync } from "node:fs";
      import { evaluatePolicies, hasBlockingFinding } from "@changesafe/core";
      import { networkDomain, IncidentBundleSchema } from "@changesafe/domain-network";
      import { createTerraformDomain } from "@changesafe/domain-terraform";
      import { KubernetesSnapshotSchema } from "@changesafe/domain-kubernetes";

      const bundle = IncidentBundleSchema.parse(
        JSON.parse(readFileSync(${JSON.stringify(path.join(root, "scenarios/network/scenario-b-route-leak/incident.json"))}, "utf8")),
      );
      const { proposal } = JSON.parse(
        readFileSync(${JSON.stringify(path.join(root, "scenarios/network/scenario-b-route-leak/replay-fixture.json"))}, "utf8"),
      );

      const { findings, riskLevel } = evaluatePolicies(networkDomain, bundle, proposal);
      process.stdout.write(JSON.stringify({
        blocked: hasBlockingFinding(findings),
        riskLevel,
        policies: findings.map((finding) => finding.policyId),
        terraformDomainId: createTerraformDomain().domainId,
        kubernetesSnapshotVersion: KubernetesSnapshotSchema.parse({
          snapshotVersion: "changesafe-kubernetes-snapshot/v1",
          snapshotId: "snapshot-package-smoke",
          evidenceId: "ev-package-smoke",
          provenance: {
            source: "authored",
            collectedAtUtc: "2026-07-29T00:00:00.000Z",
            contextFingerprint: "package-smoke",
            namespaces: ["default"],
            serverVersion: null,
          },
          resources: [],
        }).snapshotVersion,
      }));
      `,
    );

    const output = execFileSync("node", [script], { cwd: consumer, encoding: "utf8" });
    const result = JSON.parse(output) as {
      blocked: boolean;
      riskLevel: string;
      policies: string[];
      terraformDomainId: string;
      kubernetesSnapshotVersion: string;
    };

    // The red-team scenario must still be refused when the gate is reached
    // through installed packages rather than through the workspace.
    expect(result.blocked).toBe(true);
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.policies).toContain("MGMT_REACHABILITY");
    // A cross-package import resolved: the domain found core through
    // node_modules, not through a workspace alias.
    expect(result.terraformDomainId).toBe("terraform");
    // The new v0.3 domain must be imported from the packed artifact too. This
    // catches raw tsc output with extensionless ESM imports before publication.
    expect(result.kubernetesSnapshotVersion).toBe("changesafe-kubernetes-snapshot/v1");
  });

  it("ships types a consumer can compile against", () => {
    const project = path.join(consumer, "types-check");
    mkdirSync(project, { recursive: true });
    writeFileSync(
      path.join(project, "use.ts"),
      `
      import { deriveRiskLevel, type PolicyFinding } from "@changesafe/core";
      const findings: Pick<PolicyFinding, "status">[] = [{ status: "WARN" }];
      export const risk = deriveRiskLevel(findings);
      `,
    );
    writeFileSync(
      path.join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          // The strict pair. NodeNext rejects a package whose declarations use
          // extensionless relative imports — the failure mode this packaging
          // change exists to avoid — and it is what a plain Node + TypeScript
          // consumer uses by default.
          module: "nodenext",
          moduleResolution: "nodenext",
          skipLibCheck: false,
        },
        include: ["use.ts"],
      }),
    );

    // Runs from the consumer's node_modules, so it resolves @changesafe/core
    // through the installed package's `exports` and `types`.
    expect(() =>
      execFileSync("node", [path.join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
        cwd: project,
        encoding: "utf8",
      }),
    ).not.toThrow();
  });
});
