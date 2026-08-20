/**
 * Runnable entrypoint for the enforcer HTTP server, driven by environment
 * variables. Not part of the library's public API (see index.ts) — this is
 * demo/deployment infrastructure for the M2 kind reproduction
 * (examples/m2-kubernetes-enforcer), wiring createEnforcerServer's
 * injectable options to real values:
 *
 * - TRUSTED_PUBLIC_KEY_PEM: Ed25519 public key (PEM) the enforcer trusts
 *   grant signatures against.
 * - EXPECTED_POLICY_VERSION: optional; grants signed against a different
 *   policyVersion are rejected as drifted.
 * - PORT: HTTPS listen port (default 8443).
 * - TLS_CERT_PATH / TLS_KEY_PATH: PEM cert/key for the HTTPS listener.
 *
 * `readGrant` reads a base64-encoded, JSON-serialized SignedGrant from the
 * `changesafe.dev/grant` annotation on the admitted object. This is the
 * mechanism Task 10 settled on empirically: `kubectl apply` has no way to
 * attach an out-of-band header, but the Kubernetes API server always
 * forwards the full object — annotations included — inside the
 * AdmissionReview body it sends to the webhook.
 */
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";

import { importVerifyingKey } from "@changesafe/core";
import { normalizeRawResource } from "@changesafe/domain-kubernetes";

import { createEnforcerRequestListener } from "./server";
import { GRANT_ANNOTATION } from "./verify";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

function readGrantFromAnnotation(_request: unknown, review: { request: { object: unknown } }): unknown | null {
  const object = review.request.object as { metadata?: { annotations?: Record<string, string> } } | null;
  const encoded = object?.metadata?.annotations?.[GRANT_ANNOTATION];
  if (typeof encoded !== "string") return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const trustedPublicKey = await importVerifyingKey(requireEnv("TRUSTED_PUBLIC_KEY_PEM"));
  const port = Number(process.env.PORT ?? "8443");
  const expectedPolicyVersion = process.env.EXPECTED_POLICY_VERSION;

  const listener = createEnforcerRequestListener({
    trustedPublicKey,
    now: () => new Date(),
    resolveExpectedResource: (object) => normalizeRawResource(object, "ev-admission-review").resourceId,
    expectedPolicyVersion,
    readGrant: readGrantFromAnnotation,
  });

  const httpsServer = createHttpsServer(
    {
      cert: readFileSync(requireEnv("TLS_CERT_PATH")),
      key: readFileSync(requireEnv("TLS_KEY_PATH")),
    },
    listener,
  );

  httpsServer.listen(port, () => {
    console.log(`changesafe-kubernetes-enforcer listening on :${port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
