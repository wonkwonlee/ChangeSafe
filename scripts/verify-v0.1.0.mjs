import path from "node:path";

import {
  ReleaseVerificationError,
  verifyBundle,
} from "./lib/v0.1.0-release.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

try {
  const summary = await verifyBundle({
    repoRoot,
    bundleDir: path.join(repoRoot, "verification", "v0.1.0"),
    compareTag: true,
  });
  process.stdout.write(
    `ChangeSafe v0.1.0 snapshot verified\n` +
      `receipt: ${summary.receiptId}\n` +
      `key:     ${summary.publicKeyId}\n`,
  );
} catch (error) {
  const check = error instanceof ReleaseVerificationError
    ? error.message.replace(/^verification failed: /, "")
    : "internal check";
  process.stderr.write(`ChangeSafe v0.1.0 verification failed: ${check}\n`);
  process.exitCode = 2;
}
