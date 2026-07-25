import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateSigningKeyPair } from "@changesafe/core";

import { UsageError } from "./io";
import { EXIT_OK, paint, type Console } from "./output";

export interface KeygenOptions {
  /** Base path; `.pem` holds the private key and `.pub.pem` the public one. */
  out: string;
  force: boolean;
  format: "pretty" | "json";
}

/**
 * Generate an Ed25519 signing key pair for receipts.
 *
 * The private key is written with owner-only permissions and never leaves
 * this machine; the public key is what you hand to anyone who needs to check
 * your receipts. Overwriting an existing key silently would invalidate every
 * receipt already signed with it, so it requires --force.
 */
export async function runKeygen(options: KeygenOptions, console: Console): Promise<number> {
  const privatePath = options.out.endsWith(".pem") ? options.out : `${options.out}.pem`;
  const publicPath = privatePath.replace(/\.pem$/, ".pub.pem");

  for (const target of [privatePath, publicPath]) {
    if (existsSync(target) && !options.force) {
      throw new UsageError(
        `${path.resolve(target)} already exists. Receipts signed with the current key can no longer be verified if you replace it — pass --force if that is what you intend.`,
      );
    }
  }

  const keyPair = await generateSigningKeyPair();

  // Owner read/write only: a signing key that other local users can read is
  // not a signing key.
  writeFileSync(privatePath, keyPair.privateKeyPem, { mode: 0o600 });
  writeFileSync(publicPath, keyPair.publicKeyPem, { mode: 0o644 });

  if (options.format === "json") {
    console.out(
      JSON.stringify(
        { publicKeyId: keyPair.publicKeyId, privateKey: privatePath, publicKey: publicPath },
        null,
        2,
      ),
    );
    return EXIT_OK;
  }

  console.out("");
  console.out(`  ${paint(console.color, "bold", "ChangeSafe signing key")}`);
  console.out(`  ${paint(console.color, "dim", `key id ${keyPair.publicKeyId}`)}`);
  console.out("");
  console.out(`  private  ${privatePath}  ${paint(console.color, "dim", "(mode 0600 — never commit or share this)")}`);
  console.out(`  public   ${publicPath}  ${paint(console.color, "dim", "(distribute this to verifiers)")}`);
  console.out("");
  console.out(`  ${paint(console.color, "dim", "Sign receipts:  changesafe gate ... --receipt r.json --sign-key " + privatePath)}`);
  console.out(`  ${paint(console.color, "dim", "Verify them:    changesafe verify r.json --public-key " + publicPath)}`);
  console.out("");

  return EXIT_OK;
}
