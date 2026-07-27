import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CLI_APP_VERSION, SERVER_APP_VERSION } from "changesafe/version";
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
const readVersion = (relative: string): string =>
  JSON.parse(readFileSync(path.join(root, relative, "package.json"), "utf8")).version;

describe("build identity tracks package versions", () => {
  it("names the CLI's own version", () => {
    expect(CLI_APP_VERSION).toBe(`changesafe-cli-${readVersion("packages/cli")}`);
  });

  it("names the server's own version", () => {
    // The server ships inside the CLI bundle, so it releases with it.
    expect(SERVER_APP_VERSION).toBe(`changesafe-server-${readVersion("packages/cli")}`);
  });

  it("names the app's own version", () => {
    expect(APP_VERSION).toBe(readVersion("."));
  });
});

describe("policy versions are not release versions", () => {
  it("stays put while package versions move", () => {
    // Deliberately hard-coded. If a change to policy behavior makes one of
    // these fail, that is the reminder to update it *and* the receipt tests —
    // and to be sure the behavior really did change, because every receipt
    // ever issued is compared through this string.
    expect(CORE_POLICY_VERSION).toBe("core-v0.1.0");
    expect(NETWORK_POLICY_VERSION).toBe("network-v0.1.0");
    expect(TERRAFORM_POLICY_VERSION).toBe("terraform-v0.1.0");
  });
});
