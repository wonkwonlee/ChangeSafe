import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CLI_APP_VERSION,
  CLI_PACKAGE_VERSION,
  SERVER_APP_VERSION,
} from "changesafe/version";
import { APP_VERSION } from "@/lib/domain/version";
import { CORE_POLICY_VERSION } from "@changesafe/core";
import { NETWORK_POLICY_VERSION } from "@changesafe/domain-network";
import { TERRAFORM_POLICY_VERSION } from "@changesafe/domain-terraform";

/**
 * Two version families live in a receipt and they must not be confused.
 *
 * Build identity (`appVersion`) says which binary ran and moves with every
 * release. Policy version says which gate decided and moves only when policy
 * behavior does. Bumping the second along with the first would tell every
 * reader that the rules changed when they did not, and would make receipts
 * from adjacent releases look incomparable.
 */

const root = path.resolve(import.meta.dirname, "../..");

const TARGET_VERSION = "0.5.0";
const TARGET_INTERNAL_RANGE = "^0.5.0";

const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  private: z.boolean().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const MANIFEST_PATHS = [
  ".",
  "packages/ai",
  "packages/cli",
  "packages/core",
  "packages/domain-network",
  "packages/domain-terraform",
  "packages/domain-kubernetes",
  "packages/ledger",
  "packages/server",
  "packages/kubernetes-collector",
] as const;

const PUBLISHABLE_PACKAGE_PATHS = [
  "packages/cli",
  "packages/core",
  "packages/domain-network",
  "packages/domain-terraform",
  "packages/domain-kubernetes",
] as const;

const DEFERRED_PRIVATE_PACKAGE_PATHS = [
  "packages/ai",
  "packages/ledger",
  "packages/server",
] as const;

function readManifest(relative: string) {
  return ManifestSchema.parse(
    JSON.parse(readFileSync(path.join(root, relative, "package.json"), "utf8")),
  );
}

function internalRanges(manifest: z.infer<typeof ManifestSchema>) {
  return Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }).filter(([name]) => name.startsWith("@changesafe/"));
}

describe("v0.5.0 workspace release identity", () => {
  it("moves every root and workspace manifest together", () => {
    for (const relative of MANIFEST_PATHS) {
      expect(readManifest(relative).version, `${relative}/package.json version`).toBe(
        TARGET_VERSION,
      );
    }
  });

  it("uses the adopted compatible 0.3.x range on every internal edge", () => {
    for (const relative of MANIFEST_PATHS) {
      for (const [dependency, range] of internalRanges(readManifest(relative))) {
        expect(range, `${relative} -> ${dependency}`).toBe(TARGET_INTERNAL_RANGE);
      }
    }
  });

  it("publishes only the CLI, core, and two selected domains", () => {
    expect(readManifest(".").private).toBe(true);
    for (const relative of PUBLISHABLE_PACKAGE_PATHS) {
      expect(readManifest(relative).private, relative).not.toBe(true);
    }
    for (const relative of DEFERRED_PRIVATE_PACKAGE_PATHS) {
      expect(readManifest(relative).private, relative).toBe(true);
    }
  });
});

describe("build identity tracks package versions", () => {
  it("names the CLI package and receipts from one version constant", () => {
    const cliVersion = readManifest("packages/cli").version;
    expect(CLI_PACKAGE_VERSION).toBe(cliVersion);
    expect(CLI_APP_VERSION).toBe(`changesafe-cli-${cliVersion}`);
    expect(SERVER_APP_VERSION).toBe(`changesafe-server-${cliVersion}`);
  });

  it("names the app's own version", () => {
    expect(APP_VERSION).toBe(readManifest(".").version);
  });
});

describe("policy versions are not release versions", () => {
  it("stays put while package versions move", () => {
    // Deliberately hard-coded. If a change to policy behavior makes one of
    // these fail, that is the reminder to update it *and* the receipt tests —
    // and to be sure the behavior really did change, because every receipt
    // ever issued is compared through this string.
    expect(CORE_POLICY_VERSION).toBe("core-v0.2.0");
    expect(NETWORK_POLICY_VERSION).toBe("network-v0.1.0");
    expect(TERRAFORM_POLICY_VERSION).toBe("terraform-v0.2.0");
  });
});
